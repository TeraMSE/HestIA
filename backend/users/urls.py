from django.urls import path
from .views import my_persona, user_persona, my_friends, accept_friend, search_users

urlpatterns = [
    path("users/me/persona/",              my_persona,    name="my-persona"),
    path("users/<int:user_id>/persona/",   user_persona,  name="user-persona"),
    path("users/me/friends/",              my_friends,    name="my-friends"),
    path("users/me/friends/<int:friendship_id>/accept/", accept_friend, name="accept-friend"),
    path("users/search/",                  search_users,  name="search-users"),
]
