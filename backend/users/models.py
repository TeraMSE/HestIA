from django.db import models
from django.conf import settings
from django.contrib.auth.models import AbstractUser, UserManager


class CustomUserManager(UserManager):
    """Make username optional — default it to email when not provided."""

    def create_user(self, username=None, email=None, password=None, **extra_fields):
        if not email:
            raise ValueError("Email is required")
        email = self.normalize_email(email)
        # username must be unique in AbstractUser; default to email if not given
        username = username or email
        return super().create_user(username=username, email=email, password=password, **extra_fields)

    def create_superuser(self, username=None, email=None, password=None, **extra_fields):
        email = email or username  # allow: manage.py createsuperuser --email=...
        username = username or email
        return super().create_superuser(username=username, email=email, password=password, **extra_fields)


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

    # Living preference fields (optional — used to pre-fill PersonaBuilder)
    bio = models.TextField(blank=True, max_length=500)
    noise_tolerance = models.PositiveSmallIntegerField(null=True, blank=True)      # 0–100
    cleanliness = models.PositiveSmallIntegerField(null=True, blank=True)          # 0–100
    thermal_sensitivity = models.PositiveSmallIntegerField(null=True, blank=True)  # 0–100
    smoker = models.BooleanField(null=True, blank=True)
    daily_schedule = models.CharField(
        max_length=15,
        choices=[("early_bird", "Early Bird"), ("flexible", "Flexible"), ("night_owl", "Night Owl")],
        blank=True,
    )

    objects = CustomUserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []   # username is auto-set to email; no extra fields needed for createsuperuser

    def save(self, *args, **kwargs):
        # Always keep username in sync with email (needed by AbstractUser internally)
        if not self.username:
            self.username = self.email
        super().save(*args, **kwargs)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "User"
        verbose_name_plural = "Users"

    def __str__(self):
        return self.email


class Friendship(models.Model):
    STATUS_CHOICES = [("pending", "Pending"), ("accepted", "Accepted")]

    requester = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="sent_requests", on_delete=models.CASCADE
    )
    addressee = models.ForeignKey(
        settings.AUTH_USER_MODEL, related_name="received_requests", on_delete=models.CASCADE
    )
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="pending")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [("requester", "addressee")]
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.requester.email} → {self.addressee.email} ({self.status})"


class UserPersona(models.Model):
    """One canonical LS persona per user — synced from the PersonaBuilder."""
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="persona"
    )
    name = models.CharField(max_length=80)
    payload = models.JSONField()  # toLifeSimPersona() output
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user.email} — {self.name}"
