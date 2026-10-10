import type { z } from "zod";

import { type BinderResponse, binderResponseSchema } from "../../src/shared/schemas/binder.js";
import { type CaptureResponse, captureResponseSchema } from "../../src/shared/schemas/captures.js";
import { errorResponseSchema } from "../../src/shared/schemas/errors.js";
import {
  type FriendBinderResponse,
  friendBinderResponseSchema,
  type FriendRequestResult,
  friendRequestResultSchema,
  type FriendsResponse,
  friendsResponseSchema,
  type InboxResponse,
  inboxResponseSchema,
} from "../../src/shared/schemas/friends.js";
import {
  type CreateTradeRequest,
  type OfferAnswer,
  offerAnswerSchema,
  type SentOffer,
  sentOfferSchema,
  type SentOffersResponse,
  sentOffersResponseSchema,
} from "../../src/shared/schemas/trades.js";
import {
  type ExpansionResponse,
  expansionResponseSchema,
} from "../../src/shared/schemas/expansion.js";
import {
  type CreatePlayerResponse,
  createPlayerResponseSchema,
  type MeResponse,
  meResponseSchema,
} from "../../src/shared/schemas/players.js";

export class ApiError extends Error {
  override name = "ApiError";

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** For `daily_limit`: when captures resume (ISO, UTC). */
    readonly resumesAt?: string,
  ) {
    super(message);
  }
}

function authHeader(secret: string): Record<string, string> {
  // Header only, never in a URL (NFR-001).
  return { authorization: `Bearer ${secret}` };
}

async function request<T extends z.ZodType>(
  path: string,
  init: RequestInit,
  schema: T,
): Promise<z.output<T>> {
  const response = await fetch(path, init);
  const json: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const error = errorResponseSchema.safeParse(json);
    throw error.success
      ? new ApiError(
          response.status,
          error.data.error.code,
          error.data.error.message,
          error.data.error.resumesAt,
        )
      : new ApiError(response.status, "unknown", "Something went wrong. Try again.");
  }
  return schema.parse(json);
}

/** `POST /api/players`: the response is the only time the secret is sent (AC-002.10). */
export function createPlayer(displayName: string): Promise<CreatePlayerResponse> {
  return request(
    "/api/players",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName }),
    },
    createPlayerResponseSchema,
  );
}

/** `GET /api/me`. */
export function getMe(secret: string): Promise<MeResponse> {
  return request("/api/me", { headers: authHeader(secret) }, meResponseSchema);
}

/** `POST /api/captures`: sends a photo for identification. */
export function postCapture(secret: string, photo: Blob): Promise<CaptureResponse> {
  const body = new FormData();
  body.append("photo", photo, "photo.jpg");
  return request(
    "/api/captures",
    { method: "POST", headers: authHeader(secret), body },
    captureResponseSchema,
  );
}

/** `GET /api/binder`: the player's cards for the active expansion. */
export function getBinder(secret: string): Promise<BinderResponse> {
  return request("/api/binder", { headers: authHeader(secret) }, binderResponseSchema);
}

/** `GET /api/expansion` (public): cards and odds of the active expansion. */
export function getExpansion(): Promise<ExpansionResponse> {
  return request("/api/expansion", {}, expansionResponseSchema);
}

/** `POST /api/friend-requests` (AC-008.2). */
export function sendFriendRequest(
  secret: string,
  friendCode: string,
): Promise<FriendRequestResult> {
  return request(
    "/api/friend-requests",
    {
      method: "POST",
      headers: { ...authHeader(secret), "content-type": "application/json" },
      body: JSON.stringify({ friendCode }),
    },
    friendRequestResultSchema,
  );
}

/** `POST /api/friend-requests/:id/accept|decline` (AC-008.7). */
export function answerFriendRequest(
  secret: string,
  requestId: number,
  accept: boolean,
): Promise<FriendRequestResult> {
  return request(
    `/api/friend-requests/${requestId}/${accept ? "accept" : "decline"}`,
    { method: "POST", headers: authHeader(secret) },
    friendRequestResultSchema,
  );
}

export function getFriends(secret: string): Promise<FriendsResponse> {
  return request("/api/friends", { headers: authHeader(secret) }, friendsResponseSchema);
}

export function getFriendBinder(secret: string, friendCode: string): Promise<FriendBinderResponse> {
  return request(
    `/api/friends/${encodeURIComponent(friendCode)}/binder`,
    { headers: authHeader(secret) },
    friendBinderResponseSchema,
  );
}

export function getInbox(secret: string): Promise<InboxResponse> {
  return request("/api/inbox", { headers: authHeader(secret) }, inboxResponseSchema);
}

/** `POST /api/trades`: offer one of my cards for a friend's (AC-009.1). */
export function createTradeOffer(secret: string, offer: CreateTradeRequest): Promise<SentOffer> {
  return request(
    "/api/trades",
    {
      method: "POST",
      headers: { ...authHeader(secret), "content-type": "application/json" },
      body: JSON.stringify(offer),
    },
    sentOfferSchema,
  );
}

/** `POST /api/trades/:id/cancel` (AC-009.5). */
export function cancelTradeOffer(secret: string, offerId: number): Promise<SentOffer> {
  return request(
    `/api/trades/${offerId}/cancel`,
    { method: "POST", headers: authHeader(secret) },
    sentOfferSchema,
  );
}

/** `GET /api/trades/sent` (AC-009.6). */
export function getSentOffers(secret: string): Promise<SentOffersResponse> {
  return request("/api/trades/sent", { headers: authHeader(secret) }, sentOffersResponseSchema);
}

/** `POST /api/trades/:id/accept|decline` (AC-010.3, AC-010.6). */
export function answerTradeOffer(
  secret: string,
  offerId: number,
  accept: boolean,
): Promise<OfferAnswer> {
  return request(
    `/api/trades/${offerId}/${accept ? "accept" : "decline"}`,
    { method: "POST", headers: authHeader(secret) },
    offerAnswerSchema,
  );
}
