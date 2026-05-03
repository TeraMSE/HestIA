"""Social endpoints: persona sync, friends, property interest."""

from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import Friendship, UserPersona
from core.models import PropertyInterest

User = get_user_model()


# ── Persona ────────────────────────────────────────────────────────────────────

@api_view(["GET", "PUT"])
@permission_classes([IsAuthenticated])
def my_persona(request):
    """GET → return persona, PUT {name, payload} → upsert."""
    if request.method == "GET":
        try:
            p = request.user.persona
            return Response({"name": p.name, "payload": p.payload, "updated_at": p.updated_at})
        except UserPersona.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)

    # PUT
    name = request.data.get("name", "")
    payload = request.data.get("payload")
    if not payload:
        return Response({"error": "payload required"}, status=status.HTTP_400_BAD_REQUEST)
    p, _ = UserPersona.objects.update_or_create(
        user=request.user,
        defaults={"name": name or payload.get("name", ""), "payload": payload},
    )
    return Response({"name": p.name, "payload": p.payload, "updated_at": p.updated_at})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def user_persona(request, user_id):
    """GET another user's persona (for Persona B fetching)."""
    try:
        p = UserPersona.objects.get(user_id=user_id)
        return Response({"name": p.name, "payload": p.payload})
    except UserPersona.DoesNotExist:
        return Response(status=status.HTTP_404_NOT_FOUND)


# ── Friends ────────────────────────────────────────────────────────────────────

@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
def my_friends(request):
    """
    GET  → list accepted friends with has_persona flag.
    POST {addressee_id} → send friend request.
    """
    if request.method == "GET":
        me = request.user
        accepted = Friendship.objects.filter(
            requester=me, status="accepted"
        ) | Friendship.objects.filter(addressee=me, status="accepted")

        friends = []
        for f in accepted:
            other = f.addressee if f.requester == me else f.requester
            friends.append({
                "id": other.id,
                "email": other.email,
                "display_name": other.get_full_name() or other.username or other.email.split("@")[0],
                "has_persona": UserPersona.objects.filter(user=other).exists(),
                "friendship_id": f.id,
            })
        return Response(friends)

    # POST
    addressee_id = request.data.get("addressee_id")
    if not addressee_id:
        return Response({"error": "addressee_id required"}, status=status.HTTP_400_BAD_REQUEST)
    try:
        addressee = User.objects.get(id=addressee_id)
    except User.DoesNotExist:
        return Response({"error": "user not found"}, status=status.HTTP_404_NOT_FOUND)

    if addressee == request.user:
        return Response({"error": "cannot friend yourself"}, status=status.HTTP_400_BAD_REQUEST)

    f, created = Friendship.objects.get_or_create(
        requester=request.user, addressee=addressee
    )
    code = status.HTTP_201_CREATED if created else status.HTTP_200_OK
    return Response({"id": f.id, "status": f.status}, status=code)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def accept_friend(request, friendship_id):
    """Accept an incoming friend request."""
    try:
        f = Friendship.objects.get(id=friendship_id, addressee=request.user, status="pending")
    except Friendship.DoesNotExist:
        return Response({"error": "not found"}, status=status.HTTP_404_NOT_FOUND)
    f.status = "accepted"
    f.save()
    return Response({"id": f.id, "status": f.status})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def search_users(request):
    """Search users by email prefix (for sending friend requests)."""
    q = request.GET.get("q", "").strip()
    if len(q) < 2:
        return Response([])
    qs = User.objects.filter(email__icontains=q).exclude(id=request.user.id)[:10]
    return Response([
        {"id": u.id, "email": u.email,
         "display_name": u.get_full_name() or u.username or u.email.split("@")[0]}
        for u in qs
    ])


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_interests(request):
    """Return the list of property IDs the current user has marked interest in."""
    ids = PropertyInterest.objects.filter(user=request.user).values_list("property_id", flat=True)
    return Response({"interested_property_ids": [str(i) for i in ids]})
