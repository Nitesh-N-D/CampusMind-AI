"""
Question analysis: turns a (already follow-up-resolved) question into a typed
plan that retrieval and answer generation can follow.

It is deliberately rule-based. It adds no model call, so no latency or cost,
and it never produces facts - only a description of what is being asked:

* intent    - what kind of answer is expected (count, list, comparison, ...)
* breadth   - how much evidence the intent needs: one fact (narrow), every
              matching record (enumerate), or wide coverage (broad)
* parts     - a message that asks several things is split so each is retrieved
              and answered on its own
* sides     - the two things being compared, so each gets its own evidence
* clarify   - whether the question is too empty to retrieve anything for
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import List

from app.rag.text import content_terms

NARROW = "narrow"
ENUMERATE = "enumerate"
BROAD = "broad"


# Words that name an operation on the data rather than the data itself. A
# document never says "total" about its own subject, so their absence from the
# corpus must not count against the chunks that hold the figures to be added.
OPERATION_WORDS = "total sum average calculate calculation combined percentage add altogether difference"
COMPARATIVE_WORDS = (
    "earliest earlier latest later maximum minimum highest lowest most least more less greater smaller "
    "largest smallest best worst first last"
)
# Likewise the verbs that tell the assistant what to do with the evidence.
COMMAND_WORDS = "list name show give tell describe explain define summarize summarise compare elaborate outline enumerate"


@dataclass
class QuestionPlan:
    intent: str
    breadth: str = NARROW
    parts: List[str] = field(default_factory=list)
    sides: List[str] = field(default_factory=list)
    calculation: bool = False
    # The separately-sourced values a calculation combines ("transport fee and
    # hostel fee"); each is searched for on its own.
    operands: List[str] = field(default_factory=list)

    @property
    def multi_document(self) -> bool:
        # Comparisons, multi-part questions and calculations may draw on several documents.
        return bool(self.sides) or len(self.parts) > 1 or len(self.operands) > 1


_COMPARE = re.compile(r"compare|comparison|contrast|difference[s]? between|differ\b|\bvs\.?\b|\bversus\b|old and new", re.I)
_SUMMARY = re.compile(r"summari[sz]e|summary of|overview of|in brief|gist of", re.I)
_COUNT = re.compile(r"\bhow many\b|\bnumber of\b|\bcount of\b|\btotal number\b", re.I)
_ELIGIBILITY = re.compile(r"eligib|who can (apply|register|enrol|enroll|take|join)|qualif|criteria|requirements? (for|to)\b", re.I)
_CONDITIONAL = re.compile(r"^\s*(what|how)\s+(happens?|will happen|if)\b.*\bif\b|^\s*what if\b|^\s*(what|how) (should|do|can) i .*\bif\b|\bin case (of|i|my)\b|^\s*if\b", re.I)
_TEMPORAL = re.compile(r"deadline|\bwhen\b|due date|last date|what time|\bstart date\b|\bend date\b|\bdepart|\barrive", re.I)
_TASK = re.compile(r"checklist|steps? to|step by step|how (do|can|should) i|how to|what should i do|procedure|process (to|for|of)", re.I)
_WHY = re.compile(r"^\s*why\b|\bwhy (is|are|do|does|did|must|should|can't|cannot)\b|\breason (for|why)\b", re.I)
_EXPLAIN = re.compile(r"explain|in detail|describe|elaborate|walk me through|tell me about|give me more detail|more detail", re.I)
_DEFINE = re.compile(r"\bdefine\b|\bdefinition of\b|\bmeaning of\b|\bwhat does .* mean\b|\bwhat is meant by\b|^\s*what (is|are) (a|an)\b", re.I)
_LOCATION = re.compile(r"^\s*where\b|\bwhere (is|are|does|do|can|will)\b|\bwhich (place|places|location|locations|venue|venues|campus|building|block|hall)\b|\bvenue\b|\bdestination\b|\bstarts? (at|from)\b|\bends? (at|in)\b", re.I)
_NUMERICAL = re.compile(r"calculate|\btotal\b|\bsum of\b|\baverage\b|\bpercentage\b|\bhow much (more|less|extra)\b|\bin all\b|\bcombined\b|\badd up\b", re.I)
_LIST = re.compile(r"\bwhat are\b|\bwhich\b|\blist\b|\bwhat topics\b|\bname the\b|\bgive me all\b|\bshow all\b|\ball the\b", re.I)
_BROAD_SCOPE = re.compile(r"\b(complete|entire|whole|comprehensive|full|all about)\b|\bin detail\b|\bdetailed\b", re.I)
_CALCULATION = re.compile(r"calculate|\btotal\b|\bsum\b|\baverage\b|\bpercentage\b|\bhow much (more|less|extra)\b|\bcombined\b|\badd up\b|\bhow many (more|fewer|less)\b", re.I)


def classify_intent(query: str) -> str:
    """The answer shape the question asks for. Order matters: the more
    specific shapes are tested before the generic ones."""
    if _COMPARE.search(query):
        return "comparison"
    if _SUMMARY.search(query):
        return "summarization"
    if _COUNT.search(query):
        return "count"
    if _ELIGIBILITY.search(query):
        return "eligibility"
    if _CONDITIONAL.search(query):
        return "conditional"
    if _TEMPORAL.search(query):
        return "temporal"
    if _TASK.search(query):
        return "task"
    if _WHY.search(query):
        return "why"
    if _EXPLAIN.search(query):
        return "explanation"
    if _DEFINE.search(query):
        return "definition"
    if _LOCATION.search(query):
        return "location"
    if _NUMERICAL.search(query):
        return "numerical"
    if _LIST.search(query):
        return "list"
    return "factual"


def _breadth(intent: str, query: str) -> str:
    if intent in ("count", "list"):
        return ENUMERATE  # every matching record, not the few most similar
    if intent in ("summarization", "comparison") or (
        intent in ("explanation", "task", "eligibility", "definition") and _BROAD_SCOPE.search(query)
    ):
        return BROAD
    return NARROW


_PART_SPLIT = re.compile(
    r"\?\s+(?=\S)|;\s+"
    r"|\s+(?:and|also|plus|then)\s+(?=(?:what|when|where|who|whom|which|why|how|list|explain|compare|give|tell|summari[sz]e)\b)",
    re.I,
)


def split_parts(query: str) -> List[str]:
    """Separate questions asked in one message. Empty unless there are at least two."""
    pieces = [p.strip(" ?.,") for p in _PART_SPLIT.split(query) if p and p.strip(" ?.,")]
    pieces = [p for p in pieces if content_terms(p)]
    return pieces if len(pieces) > 1 else []


_SIDE_PATTERNS = [
    re.compile(r"\bdifferences?\s+between\s+(?P<a>.+?)\s+and\s+(?P<b>.+)", re.I),
    re.compile(r"\b(?:compare|comparing|comparison\s+of|contrast)\s+(?P<a>.+?)\s+(?:and|with|to|against|vs\.?|versus)\s+(?P<b>.+)", re.I),
    re.compile(r"(?P<a>.+?)\s+(?:vs\.?|versus)\s+(?P<b>.+)", re.I),
]
_SIDE_TAIL = re.compile(r"\s+(?:in terms of|based on|with respect to|regarding|with regard to)\b.*$", re.I)


def _clean_side(text: str) -> str:
    text = _SIDE_TAIL.sub("", text).strip(" ?.,")
    return re.sub(r"^(the|a|an)\s+", "", text, flags=re.I)


def comparison_sides(query: str) -> List[str]:
    for pattern in _SIDE_PATTERNS:
        m = pattern.search(query)
        if m:
            sides = [_clean_side(m.group("a")), _clean_side(m.group("b"))]
            if all(content_terms(s) for s in sides) and sides[0].lower() != sides[1].lower():
                return sides
    return []


_OPERAND_SPLIT = re.compile(r"\s*,\s*|\s+(?:and|plus|with)\s+", re.I)


def calculation_operands(query: str) -> List[str]:
    pieces = [p.strip(" ?.") for p in _OPERAND_SPLIT.split(query) if p and p.strip(" ?.")]
    pieces = [p for p in pieces if content_terms(p)]
    return pieces if len(pieces) > 1 else []


def analyze_question(query: str) -> QuestionPlan:
    intent = classify_intent(query)
    parts = split_parts(query)
    sides = comparison_sides(query) if intent == "comparison" else []
    calculation = bool(_CALCULATION.search(query)) or intent == "numerical"
    return QuestionPlan(
        intent=intent,
        breadth=_breadth(intent, query),
        parts=[] if sides else parts,
        sides=sides,
        calculation=calculation,
        operands=calculation_operands(query) if calculation and not sides and not parts else [],
    )


def needs_clarification(query: str, has_history: bool) -> bool:
    """True when nothing in the message says what is being asked and there is
    no conversation to borrow meaning from ("tell me", "what about it?")."""
    return not has_history and not content_terms(query)


_STATEMENT_START = re.compile(
    r"^\s*(?:actually,?\s+|correction:?\s+|note that\s+|by the way,?\s+)*"
    r"(?:my(?:\s+\w+){1,3}\s+(?:is|are|was|were|has|have)\b"
    r"|i\s+(?:am|take|live|study|stay|use|prefer|travel|commute|belong|joined|have)\b"
    r"|i'm\b|i've\b)",
    re.I,
)
_ASKING = re.compile(
    r"\?|\b(what|when|where|who|whom|which|why|how|list|tell|explain|give|show|compare|describe|can you|could you|"
    r"please)\b",
    re.I,
)


def is_statement(query: str) -> bool:
    """A first-person remark the student is telling the assistant ("I take bus
    route R6"), not asking it. It is kept in the conversation for later
    questions and needs no document search."""
    return bool(_STATEMENT_START.search(query)) and not _ASKING.search(query)
