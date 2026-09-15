from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.security import create_access_token, hash_password, verify_password
from app.db import models
from app.db.database import get_db
from app.schemas.schemas import CollegeCreate, LoginRequest, StudentRegister, TokenResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _domain_of(email: str) -> str:
    return email.split("@")[-1].lower().strip()


@router.post("/register-college", response_model=TokenResponse)
def register_college(payload: CollegeCreate, db: Session = Depends(get_db)):
    """An admin creates a brand-new college workspace. The domain they supply
    here becomes the ONLY domain future students of that college can register
    with - this is what scopes 'official college mail id only' per college,
    and lets any number of colleges/admins share one CampusMind AI deployment
    without seeing each other's data."""

    admin_domain = _domain_of(payload.admin_email)
    supplied_domain = payload.official_domain.lower().strip().lstrip("@")
    if admin_domain != supplied_domain:
        raise HTTPException(
            status_code=400,
            detail="Your admin email must belong to the official domain you're registering.",
        )

    existing = db.query(models.College).filter(
        models.College.official_domain == supplied_domain
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="This college domain is already registered.")

    existing_user = db.query(models.User).filter(models.User.email == payload.admin_email).first()
    if existing_user:
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    college = models.College(name=payload.college_name, official_domain=supplied_domain)
    db.add(college)
    db.flush()

    admin = models.User(
        college_id=college.id,
        email=payload.admin_email,
        full_name=payload.admin_full_name,
        hashed_password=hash_password(payload.admin_password),
        role=models.UserRole.ADMIN,
        status=models.UserStatus.ACTIVE,
        is_active=True,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)

    token = create_access_token({"sub": str(admin.id), "role": admin.role.value})
    return TokenResponse(
        access_token=token,
        role=admin.role.value,
        college_id=college.id,
        college_name=college.name,
        full_name=admin.full_name,
    )


@router.post("/register-student", response_model=TokenResponse)
def register_student(payload: StudentRegister, db: Session = Depends(get_db)):
    domain = _domain_of(payload.email)
    college = db.query(models.College).filter(models.College.official_domain == domain).first()
    if not college:
        raise HTTPException(
            status_code=400,
            detail=(
                "This email domain isn't registered to any college on CampusMind AI yet. "
                "Ask your college admin to set up a workspace first, or use your official "
                "college email address."
            ),
        )

    existing_user = db.query(models.User).filter(models.User.email == payload.email).first()
    if existing_user:
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    if payload.role not in ("student", "faculty"):
        raise HTTPException(status_code=400, detail="Role must be 'student' or 'faculty'.")

    student = models.User(
        college_id=college.id,
        email=payload.email,
        full_name=payload.full_name,
        hashed_password=hash_password(payload.password),
        role=models.UserRole(payload.role),
        status=models.UserStatus.ACTIVE,
        is_active=True,
        department=payload.department,
        year=payload.year if payload.role == "student" else None,
        semester=payload.semester if payload.role == "student" else None,
        section=payload.section if payload.role == "student" else None,
    )
    db.add(student)
    db.commit()
    db.refresh(student)

    token = create_access_token({"sub": str(student.id), "role": student.role.value})
    return TokenResponse(
        access_token=token,
        role=student.role.value,
        college_id=college.id,
        college_name=college.name,
        full_name=student.full_name,
    )


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is not active")

    token = create_access_token({"sub": str(user.id), "role": user.role.value})
    return TokenResponse(
        access_token=token,
        role=user.role.value,
        college_id=user.college_id,
        college_name=user.college.name,
        full_name=user.full_name,
    )
