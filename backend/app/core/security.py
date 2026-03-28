"""Security utilities: Fernet encryption for sensitive fields."""
from cryptography.fernet import Fernet
from app.core.config import settings


def _get_fernet() -> Fernet | None:
    """Return Fernet instance if key is configured and valid."""
    if settings.FERNET_KEY:
        try:
            return Fernet(settings.FERNET_KEY.encode())
        except Exception:
            return None
    return None


def encrypt_token(plaintext: str) -> str:
    """Encrypt a sensitive string. Returns plaintext if no key configured."""
    fernet = _get_fernet()
    if fernet and plaintext:
        return fernet.encrypt(plaintext.encode()).decode()
    return plaintext


def decrypt_token(ciphertext: str) -> str:
    """Decrypt a Fernet-encrypted string. Returns ciphertext if no key configured."""
    fernet = _get_fernet()
    if fernet and ciphertext:
        try:
            return fernet.decrypt(ciphertext.encode()).decode()
        except Exception:
            return ciphertext
    return ciphertext
