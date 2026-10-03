"""Prints a fresh VAPID key pair for Web Push. Output goes to the terminal only;
nothing is written to disk. Put the values in your host's environment variables
(Render), never in git.

    python scripts/generate_vapid_keys.py
"""
import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


key = ec.generate_private_key(ec.SECP256R1())
private = key.private_numbers().private_value.to_bytes(32, "big")
public = key.public_key().public_bytes(
    serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
)

print("Add these to the backend environment (Render):")
print(f"VAPID_PUBLIC_KEY={b64url(public)}")
print(f"VAPID_PRIVATE_KEY={b64url(private)}")
print("VAPID_SUBJECT=mailto:you@your-college.edu")
print("\nThe private key is a secret: never commit it or expose it to the frontend.")
