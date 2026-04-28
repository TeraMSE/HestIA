from django.db import models
from django.contrib.auth.models import AbstractUser


class CustomUser(AbstractUser):
    ROLE_CHOICES = [
        ("renter", "Renter"),
        ("buyer", "Buyer"),
        ("landlord", "Landlord"),
    ]

    email = models.EmailField(unique=True)
    role = models.CharField(max_length=16, choices=ROLE_CHOICES, default="renter")
    verified_email = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["username"]

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "User"
        verbose_name_plural = "Users"

    def __str__(self):
        return self.email
