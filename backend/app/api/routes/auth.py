from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.core.deps import get_current_user
from app.core.security import (
    create_access_token,
    generate_token,
    hash_password,
    verify_password,
)
from app.models.user import User
from app.schemas.user import (
    LoginRequest,
    ResendVerificationRequest,
    SignupRequest,
    UserResponse,
)
from app.services.email import send_verification_email

router = APIRouter(prefix="/api/auth", tags=["auth"])

VERIFICATION_TOKEN_TTL = timedelta(hours=24)
COOKIE_NAME = "session_token"
COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60


def _user_response(user: User) -> UserResponse:
    return UserResponse(id=str(user.id), email=user.email, is_verified=user.is_verified)


@router.post("/signup", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def signup(payload: SignupRequest):
    existing = await User.find_one(User.email == payload.email)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    token = generate_token()
    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        verification_token=token,
        verification_token_expires=datetime.now(timezone.utc) + VERIFICATION_TOKEN_TTL,
    )
    await user.insert()

    await send_verification_email(user.email, token)

    return _user_response(user)


@router.get("/verify-email", response_model=UserResponse)
async def verify_email(token: str):
    user = await User.find_one(User.verification_token == token)
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid verification token")

    expires = user.verification_token_expires
    if expires is not None and expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires is None or expires < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Verification token expired")

    user.is_verified = True
    user.verification_token = None
    user.verification_token_expires = None
    await user.save()

    return _user_response(user)


@router.post("/resend-verification", status_code=status.HTTP_204_NO_CONTENT)
async def resend_verification(payload: ResendVerificationRequest):
    user = await User.find_one(User.email == payload.email)
    if not user or user.is_verified:
        # Don't reveal whether the account exists or is already verified
        return

    token = generate_token()
    user.verification_token = token
    user.verification_token_expires = datetime.now(timezone.utc) + VERIFICATION_TOKEN_TTL
    await user.save()

    await send_verification_email(user.email, token)


@router.post("/login", response_model=UserResponse)
async def login(payload: LoginRequest, response: Response):
    user = await User.find_one(User.email == payload.email)
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")

    if not user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Please verify your email before logging in",
        )

    token = create_access_token(str(user.id))
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=COOKIE_MAX_AGE_SECONDS,
    )

    return _user_response(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(response: Response):
    response.delete_cookie(COOKIE_NAME)


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)):
    return _user_response(current_user)
