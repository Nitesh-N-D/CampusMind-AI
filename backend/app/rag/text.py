"""
Keyword normalization for retrieval.

Questions are mostly glue words ("what time does the ...") - left in, they
dominate term matching and pull in any chunk that shares them. Content terms
drop those words and fold simple inflections together, so "opens"/"open",
"served"/"serve" and "fees"/"fee" match each other.
"""
from __future__ import annotations

import re
from typing import List

# Unicode-aware words; a trailing % stays attached so "75%" is its own term.
_TOKEN = re.compile(r"[^\W_]+%?")

STOPWORDS = frozenset(
    """
    a about above after again against all am an and any are as at be because been before being
    below between both but by can could did do does doing down during each few for from further
    had has have having he her here hers herself him himself his how i if in into is it its itself
    just me more most my myself no nor not of off on once only or other our ours ourselves out over
    own same she should so some such than that the their theirs them themselves then there these
    they this those through to too under until up very was we were what when where which while who
    whom why will with would you your yours yourself yourselves
    also get got let may might must shall us tell know need want please thanks thank
    """.split()
)


def tokenize(text: str) -> List[str]:
    return _TOKEN.findall(text.lower())


def stem(word: str) -> str:
    """Deliberately light suffix folding - enough to match inflections of the
    same word without the over-merging of an aggressive stemmer."""
    if not word.isalpha() or len(word) <= 3:
        return word
    if word.endswith("ies") and len(word) > 4:
        word = word[:-3] + "y"
    elif word.endswith("sses"):
        word = word[:-2]
    elif word.endswith("s") and not word.endswith(("ss", "us", "is")):
        word = word[:-1]
    for suffix in ("ing", "ed"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            word = word[: -len(suffix)]
            break
    if word.endswith("e") and len(word) > 3:
        word = word[:-1]
    return word


def content_terms(text: str) -> List[str]:
    return [stem(t) for t in tokenize(text) if t not in STOPWORDS]
