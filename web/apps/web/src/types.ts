export type Role = "ADMIN" | "MODERATOR" | "ARTIST" | "USER";

export type AuthUser = {
  id: string;
  role: Role;
  email: string;
  name: string;
};

export type Journal = {
  id: string;
  name: string;
  createdAt: string;
};

export type Marker = {
  id: string;
  meetingAt: string;
  locationName: string;
  latitude: number;
  longitude: number;
};

export type PostMedia = {
  id: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  nonceBase64: string;
};

export type MeetingPost = {
  id: string;
  authorId: string;
  algorithm: string;
  visibleAfter: string;
  createdAt: string;
  ciphertextBase64: string;
  ivBase64: string;
  media: PostMedia[];
};
