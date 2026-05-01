/**
 * socialApi.ts — Thin axios wrapper for the user social endpoints:
 * persona sync, friends, and property interest.
 */
import api from "./api";
import type { LSPersona } from "@/features/persona/toLifeSimPersona";

export interface FriendEntry {
  id: number;
  email: string;
  display_name: string;
  has_persona: boolean;
  friendship_id?: number;
}

export interface InterestedUser {
  id: number;
  email: string;
  display_name: string;
  has_persona: boolean;
  is_me: boolean;
}

export interface PropertyInterestResponse {
  interested_users: InterestedUser[];
  i_am_interested: boolean;
}

export const socialApi = {
  /** Fetch the current user's canonical persona (may 404 if not set yet). */
  async getMyPersona(): Promise<{ name: string; payload: LSPersona } | null> {
    try {
      const res = await api.get("/users/me/persona/");
      return res.data;
    } catch {
      return null;
    }
  },

  /** Save/update the current user's canonical persona. */
  async saveMyPersona(persona: LSPersona): Promise<void> {
    await api.put("/users/me/persona/", { name: persona.name, payload: persona });
  },

  /** Fetch another user's persona by their user ID. */
  async getUserPersona(userId: number): Promise<{ name: string; payload: LSPersona } | null> {
    try {
      const res = await api.get(`/users/${userId}/persona/`);
      return res.data;
    } catch {
      return null;
    }
  },

  /** Get accepted friends with has_persona flag. */
  async getFriends(): Promise<FriendEntry[]> {
    try {
      const res = await api.get("/users/me/friends/");
      return res.data;
    } catch {
      return [];
    }
  },

  /** Send a friend request to another user. */
  async sendFriendRequest(addresseeId: number): Promise<void> {
    await api.post("/users/me/friends/", { addressee_id: addresseeId });
  },

  /** Accept an incoming friend request. */
  async acceptFriend(friendshipId: number): Promise<void> {
    await api.post(`/users/me/friends/${friendshipId}/accept/`);
  },

  /** Search users by email fragment. */
  async searchUsers(q: string): Promise<FriendEntry[]> {
    try {
      const res = await api.get("/users/search/", { params: { q } });
      return res.data;
    } catch {
      return [];
    }
  },

  /** Toggle "I'm interested" on a property. Returns new interest state. */
  async togglePropertyInterest(propertyId: string | number): Promise<boolean> {
    const res = await api.post(`/properties/${propertyId}/interest/`);
    return res.data.interested ?? false;
  },

  /** Get users interested in a property. */
  async getPropertyInterested(propertyId: string | number): Promise<PropertyInterestResponse> {
    const res = await api.get(`/properties/${propertyId}/interest/`);
    return res.data;
  },
};
