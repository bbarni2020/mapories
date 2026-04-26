import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { divIcon } from "leaflet";
import { MapContainer, Marker, Popup, TileLayer } from "react-leaflet";
import * as exifr from "exifr";
import { api, setAuthToken, setCsrfToken } from "./api";
import { decryptBytes, decryptText, encryptBytes, encryptText } from "./crypto";
import { AuthUser, Journal, Marker as MeetingMarker, MeetingPost, PostMedia, Role, VisibleJournalPost } from "./types";

type JournalRow = Journal & {
  _count: {
    members: number;
  };
};

type JournalResponse = {
  journal: JournalRow;
};

type AuthResponse = {
  token: string;
  accessToken: string;
  refreshToken?: string;
  csrfToken?: string;
  role: Role;
};

type AdminOverview = {
  users: number;
  journals: number;
  meetings: number;
  posts: number;
  plans: number;
};

type Plan = {
  id: string;
  name: string;
  tier: "FREE" | "PRO" | "TEAM";
  priceCents: number;
  monthlyUploadLimitBytes: string;
  isActive: boolean;
};

type AdminUser = {
  id: string;
  role: Role;
  name: string;
  email: string;
  createdAt: string;
  lastActiveAt: string | null;
  subscription: {
    id: string;
    tier: string;
    isComplimentary: boolean;
    endsAt: string | null;
  } | null;
};

type InviteEntry = {
  code: string;
  expiresAt: string;
};

type JournalMember = {
  userId: string;
};

type JournalKeyEnvelope = {
  keyVersion: number;
  encryptedKeyBase64: string;
};

type AttachmentPreview = {
  file: File;
  url: string;
};

type MeetingPreview = {
  url: string;
  name: string;
  locationFound: boolean;
};

type LightboxState = {
  url: string;
  mimeType: string;
  title: string;
};

type SectionKey = "journals" | "journalHome" | "meetings" | "posts" | "visible" | "admin";

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const DEFAULT_CENTER: [number, number] = [47.4979, 19.0402];
const AUTH_WORLD_CENTER: [number, number] = [20, 0];

const AUTH_DUMMY_MARKERS: Array<{ id: string; title: string; locationName: string; position: [number, number] }> = [
  { id: "tokyo", title: "Midnight Ramen", locationName: "Tokyo", position: [35.6764, 139.65] },
  { id: "nyc", title: "Rainy Rooftop", locationName: "New York", position: [40.7128, -74.006] },
  { id: "paris", title: "Bridge Walk", locationName: "Paris", position: [48.8566, 2.3522] },
  { id: "sydney", title: "Harbor Sunrise", locationName: "Sydney", position: [-33.8688, 151.2093] },
  { id: "cape", title: "Ocean Turn", locationName: "Cape Town", position: [-33.9249, 18.4241] },
  { id: "rio", title: "Hillside Note", locationName: "Rio", position: [-22.9068, -43.1729] },
  { id: "reykjavik", title: "Cold Morning", locationName: "Reykjavik", position: [64.1466, -21.9426] },
  { id: "singapore", title: "Night Market", locationName: "Singapore", position: [1.3521, 103.8198] },

  { id: "london", title: "Foggy Crossing", locationName: "London", position: [51.5074, -0.1278] },
  { id: "berlin", title: "Late Café", locationName: "Berlin", position: [52.52, 13.405] },
  { id: "rome", title: "Golden Alley", locationName: "Rome", position: [41.9028, 12.4964] },
  { id: "barcelona", title: "Street Guitar", locationName: "Barcelona", position: [41.3851, 2.1734] },
  { id: "amsterdam", title: "Canal Drift", locationName: "Amsterdam", position: [52.3676, 4.9041] },

  { id: "moscow", title: "Snow Echo", locationName: "Moscow", position: [55.7558, 37.6173] },
  { id: "dubai", title: "Glass Skyline", locationName: "Dubai", position: [25.2048, 55.2708] },
  { id: "mumbai", title: "Monsoon Rush", locationName: "Mumbai", position: [19.076, 72.8777] },
  { id: "bangkok", title: "Street Spice", locationName: "Bangkok", position: [13.7563, 100.5018] },
  { id: "seoul", title: "Neon Steps", locationName: "Seoul", position: [37.5665, 126.978] },

  { id: "beijing", title: "Morning Bicycle", locationName: "Beijing", position: [39.9042, 116.4074] },
  { id: "shanghai", title: "River Lights", locationName: "Shanghai", position: [31.2304, 121.4737] },
  { id: "hongkong", title: "Skyline Ferry", locationName: "Hong Kong", position: [22.3193, 114.1694] },

  { id: "la", title: "Sunset Drive", locationName: "Los Angeles", position: [34.0522, -118.2437] },
  { id: "chicago", title: "Windy Walk", locationName: "Chicago", position: [41.8781, -87.6298] },
  { id: "toronto", title: "Lake Breeze", locationName: "Toronto", position: [43.6532, -79.3832] },
  { id: "mexico", title: "Market Colors", locationName: "Mexico City", position: [19.4326, -99.1332] },

  { id: "buenosaires", title: "Tango Corner", locationName: "Buenos Aires", position: [-34.6037, -58.3816] },
  { id: "lima", title: "Cliffside View", locationName: "Lima", position: [-12.0464, -77.0428] },
  { id: "santiago", title: "Andes Glow", locationName: "Santiago", position: [-33.4489, -70.6693] },

  { id: "nairobi", title: "Savanna Edge", locationName: "Nairobi", position: [-1.2921, 36.8219] },
  { id: "lagos", title: "City Pulse", locationName: "Lagos", position: [6.5244, 3.3792] },
  { id: "cairo", title: "Desert Breeze", locationName: "Cairo", position: [30.0444, 31.2357] },

  { id: "helsinki", title: "Quiet Harbor", locationName: "Helsinki", position: [60.1699, 24.9384] },
  { id: "stockholm", title: "Island Light", locationName: "Stockholm", position: [59.3293, 18.0686] },
  { id: "oslo", title: "Fjord Silence", locationName: "Oslo", position: [59.9139, 10.7522] },
];

const warmPinIcon = divIcon({
  className: "warm-pin-icon",
  iconSize: [34, 46],
  iconAnchor: [17, 44],
  popupAnchor: [0, -38],
  html: `
    <svg viewBox="0 0 34 46" aria-hidden="true" focusable="false" width="34" height="46">
      <path d="M17 44s11-11.3 11-23.1C28 12.2 23.1 7 17 7S6 12.2 6 20.9C6 32.7 17 44 17 44Z" fill="#B5712A" opacity="0.22"/>
      <path d="M17 41.5s9-9.1 9-19.6C26 14 21.9 9.5 17 9.5S8 14 8 21.9c0 10.5 9 19.6 9 19.6Z" fill="#B5712A"/>
      <circle cx="17" cy="21" r="5.2" fill="#FAF7F2"/>
      <circle cx="17" cy="21" r="2.2" fill="#B5712A"/>
    </svg>
  `,
});

const toDataBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  return btoa(String.fromCharCode(...bytes));
};

const createJournalSecret = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes));
};

const asGiB = (bytes: number): number => Math.round((bytes / 1024 / 1024 / 1024) * 100) / 100;

const toDatetimeLocalValue = (date: Date): string => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};

const formatDate = (value: string): string =>
  new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

const formatDateTime = (value: string): string =>
  new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const getCountdown = (targetIso: string, nowMs: number) => {
  const remainingMs = new Date(targetIso).getTime() - nowMs;
  if (remainingMs <= 0) {
    return {
      done: true,
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
    };
  }

  const totalSeconds = Math.floor(remainingMs / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return {
    done: false,
    days,
    hours,
    minutes,
    seconds,
  };
};

const pad2 = (value: number): string => String(value).padStart(2, "0");

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round((bytes / 1024) * 10) / 10} KB`;
  }

  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
};

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

const glyphStrokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const Glyph = ({ children, className }: { children: ReactNode; className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className} {...glyphStrokeProps}>
    {children}
  </svg>
);

const BookIcon = () => (
  <Glyph>
    <path d="M5.5 4.5h6.2a2.3 2.3 0 0 1 2.3 2.3v13.2a2.3 2.3 0 0 0-2.3-2.3H5.5a1.5 1.5 0 0 1-1.5-1.5V6a1.5 1.5 0 0 1 1.5-1.5Z" />
    <path d="M18.5 4.5h-6.2A2.3 2.3 0 0 0 10 6.8v13.2a2.3 2.3 0 0 1 2.3-2.3h6.2a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5Z" />
    <path d="M12 7v11" />
  </Glyph>
);

const LockIcon = () => (
  <Glyph>
    <rect x="5.5" y="10.5" width="13" height="9" rx="2" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </Glyph>
);

const MapIcon = () => (
  <Glyph>
    <path d="M4 6.5 9 4l6 2.5 5-2v13.5l-5 2-6-2.5-5 2Z" />
    <path d="M9 4v13.5" />
    <path d="M15 6.5v13.5" />
  </Glyph>
);

const PostIcon = () => (
  <Glyph>
    <path d="M7 4.5h10A2.5 2.5 0 0 1 19.5 7v10A2.5 2.5 0 0 1 17 19.5H7A2.5 2.5 0 0 1 4.5 17V7A2.5 2.5 0 0 1 7 4.5Z" />
    <path d="M8 8h8" />
    <path d="M8 12h8" />
    <path d="M8 16h5" />
  </Glyph>
);

const VisibleIcon = () => (
  <Glyph>
    <path d="M2.5 12s3.8-6.5 9.5-6.5S21.5 12 21.5 12s-3.8 6.5-9.5 6.5S2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.8" />
  </Glyph>
);

const ShieldIcon = () => (
  <Glyph>
    <path d="M12 3.5 18.5 6v5.2c0 4.4-2.9 8.5-6.5 9.3-3.6-.8-6.5-4.9-6.5-9.3V6L12 3.5Z" />
    <path d="m9.6 11.7 1.8 1.8 3-3" />
  </Glyph>
);

const LogoutIcon = () => (
  <Glyph>
    <path d="M10 4.5H6.5A2.5 2.5 0 0 0 4 7v10A2.5 2.5 0 0 0 6.5 19.5H10" />
    <path d="M14 8.5 18 12.5l-4 4" />
    <path d="M18 12.5H9.5" />
  </Glyph>
);

const CopyIcon = () => (
  <Glyph>
    <rect x="8" y="8" width="10" height="10" rx="2" />
    <path d="M6 16h-.5A1.5 1.5 0 0 1 4 14.5v-8A1.5 1.5 0 0 1 5.5 5h8A1.5 1.5 0 0 1 15 6.5V7" />
  </Glyph>
);

const LocationIcon = () => (
  <Glyph>
    <path d="M12 21s5-4.5 5-10a5 5 0 1 0-10 0c0 5.5 5 10 5 10Z" />
    <circle cx="12" cy="11" r="1.8" />
  </Glyph>
);

const UploadIcon = () => (
  <Glyph>
    <path d="M12 16V5" />
    <path d="m7.5 9.5 4.5-4.5 4.5 4.5" />
    <path d="M5.5 18.5h13" />
  </Glyph>
);

const PlusIcon = () => (
  <Glyph>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </Glyph>
);

const GoogleIcon = () => (
  <span className="google-mark" aria-hidden="true">
    G
  </span>
);

const sectionConfig: Array<{ key: SectionKey; label: string; icon: () => JSX.Element }> = [
  { key: "journals", label: "Manage Journals", icon: BookIcon },
  { key: "journalHome", label: "Journal Home", icon: MapIcon },
  { key: "meetings", label: "Meetings", icon: MapIcon },
  { key: "posts", label: "Posts", icon: PostIcon },
  { key: "visible", label: "Time Capsule", icon: VisibleIcon },
  { key: "admin", label: "Admin", icon: ShieldIcon },
];

const tabItems = sectionConfig.filter((item) => item.key !== "admin");

const sectionTitleMap: Record<SectionKey, string> = {
  journals: "Manage journals",
  journalHome: "Journal home",
  meetings: "Meetings",
  posts: "Posts",
  visible: "Time Capsule",
  admin: "Admin platform",
};

export const App = () => {
  const [token, setTokenState] = useState<string | null>(localStorage.getItem("mapories_token"));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authMode, setAuthMode] = useState<"signIn" | "register">("signIn");
  const [activeSection, setActiveSection] = useState<SectionKey>("journals");
  const googleButtonRef = useRef<HTMLDivElement | null>(null);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  const [journals, setJournals] = useState<Journal[]>([]);
  const [selectedJournalId, setSelectedJournalId] = useState<string>("");
  const [journalName, setJournalName] = useState("");
  const [renameJournalName, setRenameJournalName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [inviteEntriesByJournal, setInviteEntriesByJournal] = useState<Record<string, InviteEntry[]>>({});
  const [journalSecrets, setJournalSecrets] = useState<Record<string, string>>({});
  const [initializingSecret, setInitializingSecret] = useState(false);

  const [markers, setMarkers] = useState<MeetingMarker[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string>("");
  const [postDraftMeetingId, setPostDraftMeetingId] = useState<string>("");
  const [meetingEditorId, setMeetingEditorId] = useState<string>("");
  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState(toDatetimeLocalValue(new Date()));
  const [locationName, setLocationName] = useState("");
  const [meetingPhotoDataUrl, setMeetingPhotoDataUrl] = useState<string | null>(null);
  const [latitude, setLatitude] = useState("47.4979");
  const [longitude, setLongitude] = useState("19.0402");
  const [meetingPreview, setMeetingPreview] = useState<MeetingPreview | null>(null);

  const [posts, setPosts] = useState<MeetingPost[]>([]);
  const [decryptedPosts, setDecryptedPosts] = useState<Record<string, string>>({});
  const [visibleJournalPosts, setVisibleJournalPosts] = useState<VisibleJournalPost[]>([]);
  const [decryptedVisiblePosts, setDecryptedVisiblePosts] = useState<Record<string, string>>({});
  const [capsuleNow, setCapsuleNow] = useState(() => Date.now());
  const [postText, setPostText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [attachmentPreviews, setAttachmentPreviews] = useState<AttachmentPreview[]>([]);
  const [postLatitude, setPostLatitude] = useState("47.4979");
  const [postLongitude, setPostLongitude] = useState("19.0402");
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);

  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminPlans, setAdminPlans] = useState<Plan[]>([]);
  const [adminQuery, setAdminQuery] = useState("");
  const [newPlanName, setNewPlanName] = useState("Creator");
  const [newPlanTier, setNewPlanTier] = useState<"FREE" | "PRO" | "TEAM">("PRO");
  const [newPlanPrice, setNewPlanPrice] = useState("999");
  const [newPlanStorageGiB, setNewPlanStorageGiB] = useState("10");
  const [grantPlanId, setGrantPlanId] = useState("");
  const [grantDays, setGrantDays] = useState("30");
  const [grantReason, setGrantReason] = useState("Manual support grant");

  const [loadingJournals, setLoadingJournals] = useState(false);
  const [loadingMarkers, setLoadingMarkers] = useState(false);
  const [loadingPosts, setLoadingPosts] = useState(false);
  const [loadingVisibleJournalPosts, setLoadingVisibleJournalPosts] = useState(false);
  const [loadingAdmin, setLoadingAdmin] = useState(false);

  const onAuthSuccess = (auth: AuthResponse) => {
    const nextToken = auth.accessToken || auth.token;
    setTokenState(nextToken);
    setAuthToken(nextToken);
    if (auth.csrfToken) {
      setCsrfToken(auth.csrfToken);
    }
  };

  const refreshJournals = async (nextSelectedJournalId?: string) => {
    setLoadingJournals(true);
    try {
      const response = await api.get<JournalResponse[]>("/journals");
      const next = response.data.map((item) => ({
        id: item.journal.id,
        name: item.journal.name,
        createdAt: item.journal.createdAt,
        memberCount: item.journal._count.members,
      }));
      setJournals(next);

      if (nextSelectedJournalId && next.some((journal) => journal.id === nextSelectedJournalId)) {
        setSelectedJournalId(nextSelectedJournalId);
        return;
      }

      if (!next.some((journal) => journal.id === selectedJournalId)) {
        setSelectedJournalId("");
      }
    } finally {
      setLoadingJournals(false);
    }
  };

  const refreshMarkers = async (journalId: string) => {
    if (!journalId) {
      setMarkers([]);
      return;
    }

    setLoadingMarkers(true);
    try {
      const response = await api.get<MeetingMarker[]>(`/journals/${journalId}/markers`);
      setMarkers(response.data);
    } finally {
      setLoadingMarkers(false);
    }
  };

  const refreshAdminData = async (query = adminQuery) => {
    if (user?.role !== "ADMIN") {
      return;
    }

    setLoadingAdmin(true);
    try {
      const [overview, users, plans] = await Promise.all([
        api.get<AdminOverview>("/admin/overview"),
        api.get<AdminUser[]>("/admin/users", { params: { query: query || undefined } }),
        api.get<Plan[]>("/admin/subscription-plans"),
      ]);

      setAdminOverview(overview.data);
      setAdminUsers(users.data);
      setAdminPlans(plans.data);
      if (!grantPlanId && plans.data.length > 0) {
        setGrantPlanId(plans.data[0].id);
      }
    } finally {
      setLoadingAdmin(false);
    }
  };

  const refreshPosts = async (meetingId: string) => {
    if (!meetingId) {
      setPosts([]);
      setDecryptedPosts({});
      return;
    }

    setLoadingPosts(true);
    try {
      const response = await api.get<MeetingPost[]>(`/meetings/${meetingId}/posts`);
      setPosts(response.data);
      setDecryptedPosts({});
    } finally {
      setLoadingPosts(false);
    }
  };

  const refreshVisibleJournalPosts = async (journalId: string) => {
    if (!journalId) {
      setVisibleJournalPosts([]);
      setDecryptedVisiblePosts({});
      return;
    }

    setLoadingVisibleJournalPosts(true);
    try {
      const response = await api.get<VisibleJournalPost[]>(`/journals/${journalId}/posts/timeline`);
      setVisibleJournalPosts(response.data);
      setDecryptedVisiblePosts({});
    } finally {
      setLoadingVisibleJournalPosts(false);
    }
  };

  useEffect(() => {
    setAuthToken(token);
    if (!token) {
      setUser(null);
      setJournals([]);
      setJournalSecrets({});
      setMarkers([]);
      setPosts([]);
      setDecryptedPosts({});
      setAdminOverview(null);
      setAdminUsers([]);
      setAdminPlans([]);
      setInviteEntriesByJournal({});
      setSelectedJournalId("");
      setSelectedMeetingId("");
      return;
    }

    let cancelled = false;
    api
      .get<AuthUser>("/auth/me")
      .then((response) => {
        if (!cancelled) {
          setUser(response.data);
        }
      })
      .catch(() => {
        setTokenState(null);
        setAuthToken(null);
        setCsrfToken(null);
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!user) {
      return;
    }

    refreshJournals().catch(() => setError("Could not load journals"));
    if (user.role === "ADMIN") {
      refreshAdminData().catch(() => setError("Could not load admin data"));
    } else {
      setAdminOverview(null);
      setAdminUsers([]);
      setAdminPlans([]);
    }
  }, [user]);

  useEffect(() => {
    if (!selectedJournalId) {
      setMarkers([]);
      setVisibleJournalPosts([]);
      return;
    }

    refreshMarkers(selectedJournalId).catch(() => setError("Could not load map markers"));
    refreshVisibleJournalPosts(selectedJournalId).catch(() => setError("Could not load journal timeline"));
  }, [selectedJournalId]);

  useEffect(() => {
    if (!selectedJournalId) {
      return;
    }

    ensureJournalSecret(selectedJournalId).catch(() => setError("Could not initialize journal encryption"));
  }, [selectedJournalId]);

  useEffect(() => {
    if (user?.role !== "ADMIN") {
      return;
    }

    refreshAdminData(adminQuery).catch(() => setError("Could not load admin data"));
  }, [adminQuery, user]);

  useEffect(() => {
    const next = files.map((file) => ({ file, url: URL.createObjectURL(file) }));
    setAttachmentPreviews(next);

    return () => {
      next.forEach((preview) => URL.revokeObjectURL(preview.url));
    };
  }, [files]);

  useEffect(() => {
    if (!meetingPreview) {
      return;
    }

    return () => {
      URL.revokeObjectURL(meetingPreview.url);
    };
  }, [meetingPreview]);

  useEffect(() => {
    if (!selectedJournal) {
      setRenameJournalName("");
      return;
    }

    setRenameJournalName(selectedJournal.name);
  }, [selectedJournalId, journals]);

  useEffect(() => {
    if (user?.role !== "ADMIN" && activeSection === "admin") {
      setActiveSection("journals");
    }
  }, [user, activeSection]);

  useEffect(() => {
    if (!selectedJournalId && activeSection !== "journals" && activeSection !== "admin") {
      setActiveSection("journals");
    }
  }, [selectedJournalId, activeSection]);

  useEffect(() => {
    if (!selectedMeetingId) {
      return;
    }

    setPostDraftMeetingId(selectedMeetingId);
  }, [selectedMeetingId]);

  useEffect(() => {
    if (!postDraftMeetingId) {
      return;
    }

    const meeting = markers.find((item) => item.id === postDraftMeetingId);
    if (!meeting) {
      return;
    }

    setPostLatitude(meeting.latitude.toFixed(6));
    setPostLongitude(meeting.longitude.toFixed(6));
  }, [markers, postDraftMeetingId]);

  useEffect(() => {
    const timer = window.setInterval(() => setCapsuleNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (activeSection !== "visible" || !visibleJournalPosts.length) {
      return;
    }

    decryptVisibleJournalPosts().catch(() => setError("Could not unlock the timeline"));
  }, [activeSection, capsuleNow, visibleJournalPosts, selectedJournalId]);

  useEffect(() => {
    if (activeSection !== "posts" || !posts.length) {
      return;
    }

    decryptLoadedPosts().catch(() => setError("Could not unlock post thread"));
  }, [activeSection, posts, selectedJournalId]);

  const selectedJournal = useMemo(
    () => journals.find((journal) => journal.id === selectedJournalId) ?? null,
    [journals, selectedJournalId],
  );

  const selectedCenter = useMemo<[number, number]>(() => {
    if (!markers.length) {
      return DEFAULT_CENTER;
    }

    return [markers[0].latitude, markers[0].longitude];
  }, [markers]);

  const selectedMeeting = useMemo(
    () => markers.find((marker) => marker.id === selectedMeetingId) ?? null,
    [markers, selectedMeetingId],
  );

  const selectedDraftMeeting = useMemo(
    () => markers.find((marker) => marker.id === postDraftMeetingId) ?? null,
    [markers, postDraftMeetingId],
  );

  const currentJournalSecret = selectedJournalId ? journalSecrets[selectedJournalId] ?? "" : "";
  const visibleInviteEntries = selectedJournalId ? inviteEntriesByJournal[selectedJournalId] ?? [] : [];

  const clearJournalView = () => {
    setSelectedJournalId("");
    setActiveSection("journals");
    setSelectedMeetingId("");
    setPostDraftMeetingId("");
    setMeetingEditorId("");
    setMarkers([]);
    setPosts([]);
    setDecryptedPosts({});
    setVisibleJournalPosts([]);
    setDecryptedVisiblePosts({});
  };

  const loadPosts = async (meetingId: string) => {
    setSelectedMeetingId(meetingId);
    setPostDraftMeetingId(meetingId);
    await refreshPosts(meetingId);
    setActiveSection("posts");
  };

  const openMeetingForEdit = (meetingId: string) => {
    const meeting = markers.find((item) => item.id === meetingId);
    if (!meeting) {
      return;
    }

    setMeetingEditorId(meeting.id);
    setMeetingTitle(meeting.title ?? "");
    setMeetingDate(toDatetimeLocalValue(new Date(meeting.meetingAt)));
    setLocationName(meeting.locationName ?? "");
    setLatitude(meeting.latitude.toFixed(6));
    setLongitude(meeting.longitude.toFixed(6));
    setMeetingPhotoDataUrl(meeting.photoDataUrl ?? null);
    setMeetingPreview(
      meeting.photoDataUrl
        ? { url: meeting.photoDataUrl, name: meeting.locationName, locationFound: true }
        : null,
    );
    setSelectedMeetingId(meetingId);
  };

  const resetMeetingForm = () => {
    setMeetingEditorId("");
    setMeetingTitle("");
    setMeetingDate(toDatetimeLocalValue(new Date()));
    setLocationName("");
    setLatitude("47.4979");
    setLongitude("19.0402");
    setMeetingPhotoDataUrl(null);
    setMeetingPreview(null);
  };

  const ensureJournalSecret = async (journalId: string): Promise<string> => {
    const existing = journalSecrets[journalId];
    if (existing) {
      return existing;
    }

    setInitializingSecret(true);
    try {
      const keyResponse = await api.get<JournalKeyEnvelope[]>(`/e2ee/journals/${journalId}/keys`);
      const latestEnvelope = keyResponse.data[0];
      if (latestEnvelope?.encryptedKeyBase64) {
        setJournalSecrets((current) => ({
          ...current,
          [journalId]: latestEnvelope.encryptedKeyBase64,
        }));
        return latestEnvelope.encryptedKeyBase64;
      }

      const memberResponse = await api.get<JournalMember[]>(`/journals/${journalId}/members`);
      const secret = createJournalSecret();
      await api.post(`/e2ee/journals/${journalId}/keys`, {
        keyVersion: 1,
        envelopes: memberResponse.data.map((member) => ({
          recipientUserId: member.userId,
          encryptedKeyBase64: secret,
        })),
      });

      setJournalSecrets((current) => ({
        ...current,
        [journalId]: secret,
      }));
      return secret;
    } finally {
      setInitializingSecret(false);
    }
  };

  const handleRegister = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    try {
      const response = await api.post<AuthResponse>("/auth/register", {
        email,
        name,
        password,
      });
      onAuthSuccess(response.data);
    } catch {
      setError("Registration failed");
    }
  };

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    try {
      const response = await api.post<AuthResponse>("/auth/login", {
        email,
        password,
      });
      onAuthSuccess(response.data);
    } catch {
      setError("Login failed");
    }
  };

  const createJournal = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedName = journalName.trim();
    await api.post("/journals", normalizedName ? { name: normalizedName } : {});
    await refreshJournals();
    setJournalName("");
  };

  const renameJournal = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedJournalId || !renameJournalName.trim()) {
      return;
    }

    await api.patch(`/journals/${selectedJournalId}`, { name: renameJournalName.trim() });
    await refreshJournals(selectedJournalId);
  };

  const joinJournal = async (event: FormEvent) => {
    event.preventDefault();
    if (!inviteCode.trim()) {
      return;
    }

    await api.post("/journals/join", { code: inviteCode.trim() });
    await refreshJournals();
    setInviteCode("");
  };

  const createInvite = async () => {
    if (!selectedJournalId) {
      return;
    }

    const response = await api.post<{ code: string; expiresAt: string }>(`/journals/${selectedJournalId}/invites`, {});
    setInviteEntriesByJournal((current) => ({
      ...current,
      [selectedJournalId]: [response.data, ...(current[selectedJournalId] ?? [])].slice(0, 6),
    }));
    await refreshJournals(selectedJournalId);
  };

  const saveMeeting = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedJournalId) {
      return;
    }

    const wasEditing = Boolean(meetingEditorId);

    const payload = {
      title: meetingTitle,
      meetingAt: new Date(meetingDate).toISOString(),
      timezoneIana: Intl.DateTimeFormat().resolvedOptions().timeZone,
      timezoneOffsetMinutes: -new Date(meetingDate || Date.now()).getTimezoneOffset(),
      locationName,
      photoDataUrl: meetingPhotoDataUrl ?? undefined,
      latitude: Number(latitude),
      longitude: Number(longitude),
    };

    const response = meetingEditorId
      ? await api.patch<MeetingMarker>(`/journals/${selectedJournalId}/meetings/${meetingEditorId}`, payload)
      : await api.post<MeetingMarker>(`/journals/${selectedJournalId}/meetings`, payload);

    setMeetingEditorId(response.data.id);

    await refreshMarkers(selectedJournalId);
    setSelectedMeetingId(response.data.id);
    if (wasEditing) {
      setMeetingEditorId(response.data.id);
    } else {
      resetMeetingForm();
    }
  };

  const importMeetingMetadata = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) {
      return;
    }

    if (meetingPreview?.url) {
      URL.revokeObjectURL(meetingPreview.url);
    }

    const previewUrl = URL.createObjectURL(selectedFile);

    try {
      const fileDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === "string") {
            resolve(reader.result);
            return;
          }
          reject(new Error("Invalid file payload"));
        };
        reader.onerror = () => reject(reader.error ?? new Error("Failed reading file"));
        reader.readAsDataURL(selectedFile);
      });

      const metadata = await exifr.parse(selectedFile, true);
      const nextLatitude = (metadata as { latitude?: number }).latitude;
      const nextLongitude = (metadata as { longitude?: number }).longitude;
      const dateCandidate =
        (metadata as { DateTimeOriginal?: Date | string }).DateTimeOriginal ??
        (metadata as { CreateDate?: Date | string }).CreateDate ??
        (metadata as { ModifyDate?: Date | string }).ModifyDate;

      if (typeof nextLatitude === "number" && typeof nextLongitude === "number") {
        setLatitude(nextLatitude.toFixed(6));
        setLongitude(nextLongitude.toFixed(6));
      }

      if (dateCandidate) {
        const date = dateCandidate instanceof Date ? dateCandidate : new Date(dateCandidate);
        if (!Number.isNaN(date.getTime())) {
          setMeetingDate(toDatetimeLocalValue(date));
        }
      }

      if (!locationName && typeof nextLatitude === "number" && typeof nextLongitude === "number") {
        setLocationName("Photo location");
      }

      setMeetingPhotoDataUrl(fileDataUrl);
      setMeetingPreview({ url: previewUrl, name: selectedFile.name, locationFound: true });
    } catch {
      setMeetingPhotoDataUrl(null);
      setMeetingPreview({ url: previewUrl, name: selectedFile.name, locationFound: false });
      setError("Could not read metadata from image");
    } finally {
      event.target.value = "";
    }
  };

  const useCurrentPosition = () => {
    if (!navigator.geolocation) {
      setError("Geolocation is not available in this browser");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude.toFixed(6));
        setLongitude(position.coords.longitude.toFixed(6));
        if (!locationName.trim()) {
          setLocationName("Current location");
        }
      },
      () => setError("Could not get current position"),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const submitPost = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedJournalId) {
      setError("Select a journal first");
      return;
    }

    let workingMeetingId = postDraftMeetingId || selectedMeetingId;
    if (!workingMeetingId) {
      setError("Pick a meeting first");
      return;
    }

    const journalSecret = currentJournalSecret || (await ensureJournalSecret(selectedJournalId));

    const encryptedText = await encryptText(postText, journalSecret, selectedJournalId);
    const media = await Promise.all(
      files.map(async (file) => {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const encrypted = await encryptBytes(bytes, journalSecret, selectedJournalId);

        return {
          mimeType: file.type || "application/octet-stream",
          dataBase64: encrypted.dataBase64,
          nonceBase64: encrypted.nonceBase64,
        };
      }),
    );

    await api.post(`/meetings/${workingMeetingId}/posts`, {
      ciphertextBase64: encryptedText.ciphertextBase64,
      ivBase64: encryptedText.ivBase64,
      algorithm: "AES-256-GCM",
      media,
    });

    setPostText("");
    setFiles([]);
    await refreshPosts(workingMeetingId);
    await refreshVisibleJournalPosts(selectedJournalId);
  };

  const decryptLoadedPosts = async () => {
    if (!selectedJournalId) {
      return;
    }

    const journalSecret = currentJournalSecret || (await ensureJournalSecret(selectedJournalId));

    const next: Record<string, string> = {};
    for (const post of posts) {
      try {
        next[post.id] = await decryptText(post.ciphertextBase64, post.ivBase64, journalSecret, selectedJournalId);
      } catch {
        next[post.id] = "[Locked or wrong secret]";
      }
    }

    setDecryptedPosts(next);
  };

  const decryptVisibleJournalPosts = async () => {
    if (!selectedJournalId) {
      return;
    }

    const journalSecret = currentJournalSecret || (await ensureJournalSecret(selectedJournalId));
    const next: Record<string, string> = {};

    for (const post of visibleJournalPosts) {
      if (post.visibleAfter > new Date().toISOString()) {
        continue;
      }

      try {
        next[post.id] = await decryptText(post.ciphertextBase64, post.ivBase64, journalSecret, selectedJournalId);
      } catch {
        next[post.id] = "[Locked or wrong secret]";
      }
    }

    setDecryptedVisiblePosts(next);
  };

  const openDecryptedMedia = async (media: PostMedia) => {
    if (!selectedJournalId) {
      return;
    }

    const journalSecret = currentJournalSecret || (await ensureJournalSecret(selectedJournalId));

    const response = await api.get<ArrayBuffer>(`/media/${media.id}`, {
      responseType: "arraybuffer",
    });

    const encryptedBytesBase64 = toDataBase64(response.data);
    const decryptedBytes = await decryptBytes(encryptedBytesBase64, media.nonceBase64, journalSecret, selectedJournalId);

    const decryptedBuffer = decryptedBytes.buffer.slice(
      decryptedBytes.byteOffset,
      decryptedBytes.byteOffset + decryptedBytes.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([decryptedBuffer], { type: media.mimeType });
    const url = URL.createObjectURL(blob);
    setLightbox({
      url,
      mimeType: media.mimeType,
      title: media.mimeType.startsWith("video/") ? "Video preview" : "Image preview",
    });
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout", {});
    } catch {}
    setTokenState(null);
    setAuthToken(null);
    setCsrfToken(null);
  };

  const createPlan = async (event: FormEvent) => {
    event.preventDefault();
    await api.post("/admin/subscription-plans", {
      name: newPlanName,
      tier: newPlanTier,
      priceCents: Number(newPlanPrice),
      monthlyUploadLimitBytes: Number(newPlanStorageGiB) * 1024 * 1024 * 1024,
      isActive: true,
    });
    await refreshAdminData();
  };

  const updateUserRole = async (userId: string, role: Role) => {
    await api.patch(`/admin/users/${userId}/role`, { role });
    await refreshAdminData();
  };

  const updatePlanStatus = async (planId: string, isActive: boolean) => {
    await api.patch(`/admin/subscription-plans/${planId}`, { isActive });
    await refreshAdminData();
  };

  const grantPackage = async (targetUserId: string) => {
    await api.post(`/admin/users/${targetUserId}/grant-package`, {
      planId: grantPlanId || undefined,
      daysValid: Number(grantDays),
      reason: grantReason,
      isComplimentary: true,
    });
    await refreshAdminData();
  };

  const copyInviteCode = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setError(`Copied invite code ${code}`);
  };

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !window.google || !googleButtonRef.current || token) {
      return;
    }

    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      auto_select: true,
      use_fedcm_for_prompt: true,
      callback: async (response) => {
        try {
          const auth = await api.post<AuthResponse>("/auth/google", {
            idToken: response.credential,
          });
          onAuthSuccess(auth.data);
        } catch {
          setError("Google login failed");
        }
      },
    });

    googleButtonRef.current.innerHTML = "";
    window.google.accounts.id.renderButton(googleButtonRef.current, {
      type: "standard",
      theme: "outline",
      size: "large",
      text: "signin_with",
      shape: "rectangular",
    });

    window.google.accounts.id.prompt();
  }, [token]);

  useEffect(() => {
    if (!lightbox?.url) {
      return;
    }

    return () => {
      URL.revokeObjectURL(lightbox.url);
    };
  }, [lightbox]);

  const sectionContent = useMemo(() => {
    if (!user) {
      return null;
    }

    if (activeSection === "journals") {
      return (
        <section className="screen-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">{sectionTitleMap.journals}</p>
              <h2>Shared notebooks, kept quiet.</h2>
            </div>
          </div>

          <div className="action-strip">
            <form className="split-form" onSubmit={createJournal}>
              <label>
                <span>Journal name</span>
                <input
                  value={journalName}
                  onChange={(event) => setJournalName(event.target.value)}
                  placeholder='Summer in Budapest'
                />
              </label>
              <button className="primary-button" type="submit">
                <PlusIcon />
                Create Journal
              </button>
            </form>

            <form className="split-form outline-form" onSubmit={joinJournal}>
              <label>
                <span>Invite code</span>
                <input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} placeholder="Enter code" />
              </label>
              <button className="secondary-button" type="submit">
                Join via Code
              </button>
            </form>
          </div>

          <div className="journal-layout">
            <div className="journal-grid">
              {loadingJournals ? (
                <>
                  <div className="skeleton card-skeleton" />
                  <div className="skeleton card-skeleton" />
                  <div className="skeleton card-skeleton" />
                  <div className="skeleton card-skeleton" />
                </>
              ) : (
                journals.map((journal) => (
                  <article
                    key={journal.id}
                    className={`journal-card ${journal.id === selectedJournalId ? "is-selected" : ""}`}
                    onClick={() => {
                      setSelectedJournalId(journal.id);
                      setActiveSection("journalHome");
                    }}
                  >
                    <div className="card-topline">
                      <span className="journal-dot" />
                      <span className="mono-label">Journal</span>
                    </div>
                    <h3>{journal.name}</h3>
                    <div className="journal-meta">
                      <span>{journal.memberCount} participants</span>
                      <span>{formatDate(journal.createdAt)}</span>
                    </div>
                  </article>
                ))
              )}
            </div>

            <aside className="journal-detail panel-soft">
              <div className="stack-tight">
                <div className="card-topline">
                  <span className="mono-label">Selected journal</span>
                  <span className="status-pill">{selectedJournal ? `${selectedJournal.memberCount} people` : "None"}</span>
                </div>
                <h3>{selectedJournal?.name ?? "Open a journal"}</h3>
                <p className="muted-copy">
                  {selectedJournal ? `Created ${formatDate(selectedJournal.createdAt)}. The key lives with the group.` : "Select a journal card, or create a new one above."}
                </p>
              </div>

              <form className="stack-tight journal-form" onSubmit={renameJournal}>
                <label>
                  <span>Journal title</span>
                  <input
                    value={renameJournalName}
                    onChange={(event) => setRenameJournalName(event.target.value)}
                    placeholder="Give this journal a new name"
                  />
                </label>
                <button className="secondary-button" type="submit" disabled={!selectedJournalId || !renameJournalName.trim()}>
                  Save title
                </button>
              </form>

              <div className="invite-block">
                <div className="row-between">
                  <div>
                    <p className="eyebrow">Invite people</p>
                    <h4>Active invite codes</h4>
                  </div>
                  <button className="secondary-button small-button" type="button" onClick={createInvite} disabled={!selectedJournalId}>
                    <CopyIcon />
                    Generate code
                  </button>
                </div>

                <div className="invite-list">
                  {visibleInviteEntries.length ? (
                    visibleInviteEntries.map((invite) => (
                      <div className="invite-row" key={`${invite.code}-${invite.expiresAt}`}>
                        <div>
                          <p className="mono-chip">{invite.code}</p>
                          <p className="muted-copy">Expires {formatDate(invite.expiresAt)}</p>
                        </div>
                        <button className="icon-button" type="button" onClick={() => copyInviteCode(invite.code)}>
                          <CopyIcon />
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="muted-copy">Generate a code and it will appear here immediately.</p>
                  )}
                </div>
              </div>

            </aside>
          </div>
        </section>
      );
    }

    if (activeSection === "meetings") {
      return (
        <section className="screen-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">{sectionTitleMap.meetings}</p>
              <h2>Meetings keep the thread, and old ones stay editable.</h2>
            </div>
            <div className="section-actions">
              <button className="secondary-button" type="button" onClick={useCurrentPosition}>
                <LocationIcon />
                Use My Location
              </button>
              <button className="secondary-button" type="button" onClick={resetMeetingForm}>
                <PlusIcon />
                New meeting
              </button>
            </div>
          </div>

          <div className="meetings-layout">
            <aside className="meeting-panel panel-soft">
              <form className="stack-tight" onSubmit={saveMeeting}>
                <div className="row-between">
                  <div>
                    <p className="eyebrow">{meetingEditorId ? "Editing meeting" : "Create meeting"}</p>
                    <h4>{meetingEditorId ? "Adjust the old marker" : "Pin a fresh one"}</h4>
                  </div>
                  {meetingEditorId ? <span className="status-pill">{meetingEditorId.slice(0, 6)}</span> : null}
                </div>
                <label>
                  <span>Title</span>
                  <input value={meetingTitle} onChange={(event) => setMeetingTitle(event.target.value)} placeholder="Coffee under the bridge" />
                </label>
                <label>
                  <span>Date</span>
                  <input type="datetime-local" value={meetingDate} onChange={(event) => setMeetingDate(event.target.value)} />
                </label>
                <label>
                  <span>Location name</span>
                  <input value={locationName} onChange={(event) => setLocationName(event.target.value)} placeholder="Buda embankment" />
                </label>
                <div className="grid-two-up">
                  <label>
                    <span>Lat</span>
                    <input value={latitude} onChange={(event) => setLatitude(event.target.value)} />
                  </label>
                  <label>
                    <span>Lng</span>
                    <input value={longitude} onChange={(event) => setLongitude(event.target.value)} />
                  </label>
                </div>

                <label className="drop-zone">
                  <input type="file" accept="image/*" onChange={importMeetingMetadata} />
                  <span className="drop-zone-copy">
                    <UploadIcon />
                    Drop a photo or browse for EXIF data
                  </span>
                </label>

                {meetingPreview ? (
                  <div className="photo-preview">
                    <img src={meetingPreview.url} alt={meetingPreview.name} />
                    <div>
                      <p>{meetingPreview.name}</p>
                      <span className={`status-pill ${meetingPreview.locationFound ? "is-positive" : "is-muted"}`}>
                        {meetingPreview.locationFound ? "Location found" : "No location found"}
                      </span>
                    </div>
                  </div>
                ) : null}

                <button className="primary-button" type="submit" disabled={!selectedJournalId}>
                  {meetingEditorId ? "Update Meeting" : "Seal Meeting Marker"}
                </button>
              </form>

              <div className="meeting-list">
                <p className="eyebrow">Recent meetings</p>
                {markers.length ? (
                  markers.map((meeting) => (
                    <article key={meeting.id} className={`recent-meeting-card ${meeting.id === meetingEditorId ? "is-active" : ""}`}>
                      <div>
                        <p>{meeting.locationName}</p>
                        <span>{formatDateTime(meeting.meetingAt)}</span>
                      </div>
                      <div className="pill-row">
                        <button className="secondary-button small-button" type="button" onClick={() => openMeetingForEdit(meeting.id)}>
                          Edit
                        </button>
                        <button className="secondary-button small-button" type="button" onClick={() => loadPosts(meeting.id)}>
                          Open posts
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="muted-copy">No meetings yet. Create the first one above.</p>
                )}
              </div>
            </aside>

            <div className="map-panel panel-soft">
              <div className="map-wrap">
                <MapContainer center={selectedCenter} zoom={6} scrollWheelZoom style={{ height: "100%" }}>
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                  />
                  {markers.map((marker) => (
                    <Marker key={marker.id} position={[marker.latitude, marker.longitude]} icon={warmPinIcon}>
                      <Popup>
                        <strong>{marker.locationName}</strong>
                        {marker.photoDataUrl ? (
                          <>
                            <br />
                            <img src={marker.photoDataUrl} alt={marker.locationName} style={{ width: 180, borderRadius: 8, marginTop: 8 }} />
                          </>
                        ) : null}
                        <br />
                        {formatDateTime(marker.meetingAt)}
                        <br />
                        <div className="pill-row">
                          <button className="secondary-button small-button" type="button" onClick={() => openMeetingForEdit(marker.id)}>
                            Edit meeting
                          </button>
                          <button className="secondary-button small-button" type="button" onClick={() => loadPosts(marker.id)}>
                            Open meeting posts
                          </button>
                        </div>
                      </Popup>
                    </Marker>
                  ))}
                </MapContainer>
              </div>

              <div className="meeting-summary">
                <div>
                  <p className="eyebrow">Active marker</p>
                  <h4>{selectedMeeting?.locationName ?? "No meeting selected"}</h4>
                </div>
                <p className="muted-copy">
                  {selectedMeeting ? `${formatDateTime(selectedMeeting.meetingAt)} · ${selectedMeeting.latitude.toFixed(3)}, ${selectedMeeting.longitude.toFixed(3)}` : "Click a marker to open its post thread."}
                </p>
                {selectedMeeting?.photoDataUrl ? (
                  <img src={selectedMeeting.photoDataUrl} alt={selectedMeeting.locationName} className="meeting-summary-image" />
                ) : null}
              </div>
            </div>
          </div>
        </section>
      );
    }

    if (activeSection === "journalHome") {
      return (
        <section className="screen-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">{sectionTitleMap.journalHome}</p>
              <h2>{selectedJournal?.name ?? "Select a journal"}</h2>
            </div>
            <div className="section-actions">
              <button className="secondary-button" type="button" onClick={() => setActiveSection("posts")} disabled={!selectedJournalId}>
                <PostIcon />
                New Post
              </button>
              <button className="secondary-button" type="button" onClick={() => setActiveSection("visible")} disabled={!selectedJournalId}>
                <VisibleIcon />
                Released Posts
              </button>
            </div>
          </div>

          <div className="map-panel panel-soft">
            <div className="map-wrap journal-home-map">
              <MapContainer center={selectedCenter} zoom={5} scrollWheelZoom style={{ height: "100%" }}>
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                />
                {markers.map((marker) => (
                  <Marker key={marker.id} position={[marker.latitude, marker.longitude]} icon={warmPinIcon}>
                    <Popup>
                      <strong>{marker.locationName}</strong>
                      <br />
                      {formatDateTime(marker.meetingAt)}
                      <br />
                      <button className="secondary-button small-button" type="button" onClick={() => loadPosts(marker.id)}>
                        Open posts
                      </button>
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>

            <div className="journal-home-meta">
              <div className="stat-card">
                <span>Places visited</span>
                <strong>{markers.length}</strong>
              </div>
              <div className="stat-card">
                <span>Opened posts</span>
                <strong>{visibleJournalPosts.filter((post) => post.isVisible).length}</strong>
              </div>
              <div className="stat-card">
                <span>Selected meeting</span>
                <strong>{selectedMeeting ? formatDate(selectedMeeting.meetingAt) : "None"}</strong>
              </div>
            </div>
          </div>
        </section>
      );
    }

    if (activeSection === "posts") {
      return (
        <section className="screen-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">{sectionTitleMap.posts}</p>
              <h2>Write to a meeting. No detours, no editing the event from here.</h2>
            </div>
            <div className="section-actions">
              <span className="lock-badge">
                <LockIcon />
                Meeting posts stay encrypted with the journal key
              </span>
            </div>
          </div>

          <div className="post-map-layout">
            <div className="map-panel panel-soft">
              <div className="map-wrap post-map-wrap">
                <MapContainer
                  center={selectedDraftMeeting ? [selectedDraftMeeting.latitude, selectedDraftMeeting.longitude] : [Number(postLatitude), Number(postLongitude)]}
                  zoom={selectedDraftMeeting ? 12 : 7}
                  scrollWheelZoom
                  style={{ height: "100%" }}
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                  />
                  {markers.map((marker) => (
                    <Marker key={marker.id} position={[marker.latitude, marker.longitude]} icon={warmPinIcon}>
                      <Popup>
                        <strong>{marker.locationName}</strong>
                        <br />
                        {formatDateTime(marker.meetingAt)}
                        <br />
                        {marker.photoDataUrl ? <img src={marker.photoDataUrl} alt={marker.locationName} className="meeting-summary-image" /> : null}
                        <div className="pill-row">
                          <button
                            className="secondary-button small-button"
                            type="button"
                            onClick={() => {
                              setPostDraftMeetingId(marker.id);
                              setSelectedMeetingId(marker.id);
                              refreshPosts(marker.id).catch(() => setError("Could not load recent posts"));
                            }}
                          >
                            Select meeting
                          </button>
                          <button className="secondary-button small-button" type="button" onClick={() => loadPosts(marker.id)}>
                            Open posts
                          </button>
                        </div>
                      </Popup>
                    </Marker>
                  ))}
                </MapContainer>
              </div>
            </div>

            <div className="panel-soft post-meta-form">
              <label>
                <span>Meeting for this post</span>
                <select
                  value={postDraftMeetingId}
                  onChange={(event) => {
                    const nextMeetingId = event.target.value;
                    setPostDraftMeetingId(nextMeetingId);
                    if (nextMeetingId) {
                      setSelectedMeetingId(nextMeetingId);
                      refreshPosts(nextMeetingId).catch(() => setError("Could not load recent posts"));
                    }
                  }}
                >
                  <option value="">Choose an existing meeting</option>
                  {markers.map((marker) => (
                    <option key={marker.id} value={marker.id}>
                      {marker.locationName} · {formatDate(marker.meetingAt)}
                    </option>
                  ))}
                </select>
              </label>

              {selectedDraftMeeting ? (
                <div className="meeting-summary stack-tight">
                  <div>
                    <p className="eyebrow">Selected meeting</p>
                    <h4>{selectedDraftMeeting.locationName}</h4>
                  </div>
                  <p className="muted-copy">{formatDateTime(selectedDraftMeeting.meetingAt)} · {selectedDraftMeeting.latitude.toFixed(3)}, {selectedDraftMeeting.longitude.toFixed(3)}</p>
                  {selectedDraftMeeting.photoDataUrl ? (
                    <img src={selectedDraftMeeting.photoDataUrl} alt={selectedDraftMeeting.locationName} className="meeting-summary-image" />
                  ) : null}
                </div>
              ) : (
                <p className="muted-copy">Pick a meeting from the map or dropdown before sealing the post.</p>
              )}
            </div>
          </div>

          <div className="compose-shell panel-soft">
            <form className="compose-form" onSubmit={submitPost}>
              <label className="composer-label">
                <span>Your note</span>
                <textarea
                  value={postText}
                  onChange={(event) => setPostText(event.target.value)}
                  placeholder="A few lines worth keeping."
                  rows={8}
                  className="lined-textarea"
                />
              </label>

              <div className="attach-row">
                <label className="attach-button secondary-button">
                  <UploadIcon />
                  Attach media
                  <input
                    type="file"
                    multiple
                    accept="image/*,video/*"
                    onChange={(event) => {
                      const nextFiles = Array.from(event.target.files ?? []);
                      if (!nextFiles.length) {
                        return;
                      }

                      setFiles((current) => [...current, ...nextFiles]);
                      event.target.value = "";
                    }}
                  />
                </label>
                <p className="muted-copy">Images and videos stay bundled to the post.</p>
              </div>

              {attachmentPreviews.length ? (
                <div className="attachment-strip">
                  {attachmentPreviews.map(({ file, url }, index) => (
                    <div className="attachment-chip" key={`${file.name}-${file.size}-${index}`}>
                      <img src={url} alt={file.name} />
                      <div>
                        <p>{file.name}</p>
                        <span>{formatBytes(file.size)}</span>
                      </div>
                      <button
                        className="icon-button"
                        type="button"
                        onClick={() => setFiles((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="compose-footer">
                <span className="muted-copy">{postText.length} characters</span>
                <button className="primary-button seal-button" type="submit">
                  Seal &amp; Publish
                </button>
              </div>
            </form>
          </div>

          <div className="meeting-hint panel-soft">
            <p className="eyebrow">Recent written posts</p>
            {posts.length ? (
              posts.slice(-3).reverse().map((post) => (
                <article key={post.id} className="recent-post-row">
                  <div>
                    <p>{formatDateTime(post.createdAt)}</p>
                    <span className="muted-copy">Visible after {formatDateTime(post.visibleAfter)}</span>
                  </div>
                  <span className="status-pill">{post.media.length} media</span>
                </article>
              ))
            ) : (
              <p className="muted-copy">No posts yet in this meeting thread.</p>
            )}
          </div>
        </section>
      );
    }

    if (activeSection === "visible") {
      return (
        <section className="screen-panel visible-screen">
          <div className="section-head">
            <div>
              <p className="eyebrow">{sectionTitleMap.visible}</p>
              <h2>Time Capsule</h2>
              <p className="muted-copy">Entries open themselves when the clock runs out.</p>
            </div>
          </div>

          <div className="feed-column">
            {loadingVisibleJournalPosts ? (
              <>
                <div className="skeleton feed-skeleton" />
                <div className="skeleton feed-skeleton" />
                <div className="skeleton feed-skeleton" />
              </>
            ) : visibleJournalPosts.length ? (
              visibleJournalPosts.map((post) => {
                const countdown = getCountdown(post.visibleAfter, capsuleNow);
                const revealed = countdown.done;

                return (
                  <article key={post.id} className={`feed-card ${revealed ? "is-released" : "is-locked"}`}>
                    <div className="feed-date">{formatDate(post.createdAt)}</div>
                    <h3>{post.meeting.title}</h3>
                    <p className="muted-copy">
                      By {post.authorName} · {formatDateTime(post.meeting.meetingAt)} · {post.meeting.locationName}
                    </p>
                    <div className="feed-meta-row">
                      <span className={`status-pill ${revealed ? "is-positive" : "is-muted"}`}>
                        {revealed ? "Opened" : "Sealed"}
                      </span>
                      <div className="capsule-countdown">
                        <strong className="countdown-clock">
                          {pad2(countdown.days)}:{pad2(countdown.hours)}:{pad2(countdown.minutes)}:{pad2(countdown.seconds)}
                        </strong>
                        <small className="muted-copy">days : hours : min : sec</small>
                      </div>
                    </div>
                    <p className={`feed-copy ${decryptedVisiblePosts[post.id] ? "is-revealed" : "is-locked"}`}>
                      {decryptedVisiblePosts[post.id] ?? "Waiting for the capsule to open."}
                    </p>

                    {post.media.length ? (
                      <div className="media-grid">
                        {post.media.map((media) => (
                          <button key={media.id} className="media-thumb" type="button" onClick={() => openDecryptedMedia(media)}>
                            <span>{media.mimeType.startsWith("video/") ? "Video" : "Photo"}</span>
                            <small>{formatBytes(media.sizeBytes)}</small>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })
            ) : (
              <div className="empty-state">
                <LockIcon />
                <p>No released posts yet. They appear here after release time.</p>
              </div>
            )}
          </div>
        </section>
      );
    }

    return (
      <section className="screen-panel system-panel">
        <div className="section-head">
          <div>
            <p className="eyebrow">{sectionTitleMap.admin}</p>
            <h2>Quiet controls for the people who run the lights.</h2>
          </div>
          {adminOverview ? (
            <div className="stats-strip">
              <div className="stat-card">
                <span>Users</span>
                <strong>{adminOverview.users}</strong>
              </div>
              <div className="stat-card">
                <span>Plans</span>
                <strong>{adminOverview.plans}</strong>
              </div>
              <div className="stat-card">
                <span>Posts</span>
                <strong>{adminOverview.posts}</strong>
              </div>
            </div>
          ) : null}
        </div>

        <div className="admin-grid">
          <div className="admin-column">
            <div className="panel-soft">
              <div className="card-topline">
                <p className="eyebrow">Plan management</p>
                <h4>Active plans</h4>
              </div>

              <form className="stack-tight" onSubmit={createPlan}>
                <div className="grid-two-up">
                  <label>
                    <span>Plan name</span>
                    <input value={newPlanName} onChange={(event) => setNewPlanName(event.target.value)} />
                  </label>
                  <label>
                    <span>Tier</span>
                    <select value={newPlanTier} onChange={(event) => setNewPlanTier(event.target.value as "FREE" | "PRO" | "TEAM") }>
                      <option value="FREE">FREE</option>
                      <option value="PRO">PRO</option>
                      <option value="TEAM">TEAM</option>
                    </select>
                  </label>
                </div>
                <div className="grid-two-up">
                  <label>
                    <span>Price (cents)</span>
                    <input value={newPlanPrice} onChange={(event) => setNewPlanPrice(event.target.value)} />
                  </label>
                  <label>
                    <span>Storage GiB</span>
                    <input value={newPlanStorageGiB} onChange={(event) => setNewPlanStorageGiB(event.target.value)} />
                  </label>
                </div>
                <button className="secondary-button" type="submit">Create plan</button>
              </form>

              <div className="plan-table">
                {loadingAdmin ? (
                  <div className="skeleton table-skeleton" />
                ) : (
                  adminPlans.map((plan) => (
                    <div className="plan-row" key={plan.id}>
                      <div>
                        <p>{plan.name}</p>
                        <span>{plan.tier} · {(plan.priceCents / 100).toFixed(2)} / month · {asGiB(Number(plan.monthlyUploadLimitBytes))} GiB</span>
                      </div>
                      <button
                        className={`switch-button ${plan.isActive ? "is-on" : ""}`}
                        type="button"
                        onClick={() => updatePlanStatus(plan.id, !plan.isActive)}
                      >
                        {plan.isActive ? "Active" : "Paused"}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="admin-column">
            <div className="panel-soft">
              <div className="card-topline">
                <p className="eyebrow">User search</p>
                <h4>Roles and grants</h4>
              </div>

              <input
                value={adminQuery}
                onChange={(event) => setAdminQuery(event.target.value)}
                placeholder="Search users by name or email"
                className="admin-search"
              />

              <div className="stack-tight">
                <label>
                  <span>Grant plan</span>
                  <select value={grantPlanId} onChange={(event) => setGrantPlanId(event.target.value)}>
                    <option value="">Custom free package</option>
                    {adminPlans.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="grid-two-up">
                  <label>
                    <span>Days valid</span>
                    <input value={grantDays} onChange={(event) => setGrantDays(event.target.value)} />
                  </label>
                  <label>
                    <span>Reason</span>
                    <input value={grantReason} onChange={(event) => setGrantReason(event.target.value)} />
                  </label>
                </div>
              </div>

              <div className="user-list">
                {adminUsers.map((adminUser) => (
                  <article key={adminUser.id} className="user-row">
                    <div className="user-head">
                      <div>
                        <p>{adminUser.name}</p>
                        <span>{adminUser.email}</span>
                      </div>
                      <div className="pill-row">
                        <span className="status-pill">{adminUser.role}</span>
                        <span className="status-pill is-muted">{adminUser.subscription?.tier ?? "No plan"}</span>
                      </div>
                    </div>
                    <div className="row-between user-actions">
                      <select value={adminUser.role} onChange={(event) => updateUserRole(adminUser.id, event.target.value as Role)}>
                        <option value="USER">USER</option>
                        <option value="ARTIST">ARTIST</option>
                        <option value="MODERATOR">MODERATOR</option>
                        <option value="ADMIN">ADMIN</option>
                      </select>
                      <button className="secondary-button small-button" type="button" onClick={() => grantPackage(adminUser.id)}>
                        Grant package
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }, [
    activeSection,
    adminOverview,
    adminPlans,
    adminQuery,
    adminUsers,
    attachmentPreviews,
    capsuleNow,
    files,
    grantDays,
    grantPlanId,
    grantReason,
    inviteEntriesByJournal,
    initializingSecret,
    journalName,
    journalSecrets,
    journals,
    loadingAdmin,
    loadingJournals,
    loadingMarkers,
    loadingPosts,
    locationName,
    lightbox,
    meetingEditorId,
    markers,
    meetingDate,
    meetingPreview,
    meetingTitle,
    newPlanName,
    newPlanPrice,
    newPlanStorageGiB,
    newPlanTier,
    password,
    postDraftMeetingId,
    postLatitude,
    postLongitude,
    postText,
    decryptedVisiblePosts,
    posts,
    renameJournalName,
    loadPosts,
    openMeetingForEdit,
    resetMeetingForm,
    saveMeeting,
    selectedCenter,
    selectedDraftMeeting,
    selectedJournal,
    selectedJournalId,
    selectedMeeting,
    selectedMeetingId,
    user,
  ]);

  if (!token || !user) {
    return (
      <main className="auth-shell">
        <section className="auth-card panel-soft auth-card-topography auth-layout">
          <div className="auth-hero">
            <div className="auth-hero-map-wrap">
              <MapContainer center={AUTH_WORLD_CENTER} zoom={2} scrollWheelZoom={false} style={{ height: "100%" }}>
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                />
                {AUTH_DUMMY_MARKERS.map((marker) => (
                  <Marker key={marker.id} position={marker.position} icon={warmPinIcon}>
                    <Popup>
                      <strong>{marker.title}</strong>
                      <br />
                      {marker.locationName}
                      <br />
                      Demo meeting
                    </Popup>
                  </Marker>
                ))}
              </MapContainer>
            </div>
          </div>

          <div className="auth-panel">
            <div className="auth-panel-brand">
              <p>Mapories</p>
              <span className="muted-copy">Login</span>
            </div>
            <div className="auth-tabs">
              <button className={`auth-tab ${authMode === "signIn" ? "is-active" : ""}`} type="button" onClick={() => setAuthMode("signIn")}>Sign In</button>
              <button className={`auth-tab ${authMode === "register" ? "is-active" : ""}`} type="button" onClick={() => setAuthMode("register")}>Register</button>
            </div>

            <form className="stack-tight" onSubmit={authMode === "signIn" ? handleLogin : handleRegister}>
              {authMode === "register" ? (
                <label>
                  <span>Name</span>
                  <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" />
                </label>
              ) : null}
              <label>
                <span>Email</span>
                <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
              </label>
              <label>
                <span>Password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Minimum 12 characters"
                />
              </label>
              <button className="primary-button auth-submit" type="submit">
                Open Your Journal
              </button>
            </form>

            <div className="google-card">
              <span className="eyebrow">Google one-click</span>
              <div ref={googleButtonRef} className="google-button-slot" />
              {!GOOGLE_CLIENT_ID ? (
                <button className="secondary-button google-fallback" type="button" disabled>
                  <GoogleIcon />
                  Continue with Google
                </button>
              ) : null}
            </div>

            {error ? <p className="toast-note">{error}</p> : null}
          </div>
        </section>
      </main>
    );
  }

  const navItemsBase = user.role === "ADMIN" ? sectionConfig : tabItems;
  const navItems = selectedJournalId
    ? navItemsBase.filter((item) => item.key !== "journals")
    : navItemsBase.filter((item) => item.key === "journals" || (user.role === "ADMIN" && item.key === "admin"));

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div className="brand-lockup compact">
          <div className="wordmark">
            <BookIcon />
            <div>
              <p>Mapories</p>
              <span>{selectedJournal?.name ?? "No journal selected"}</span>
            </div>
          </div>
        </div>
        {selectedJournalId ? (
          <button className="secondary-button small-button" type="button" onClick={clearJournalView}>
            Back to journals
          </button>
        ) : null}
        <div className="user-cluster">
          <div className="avatar-chip">{initials(user.name)}</div>
          <div>
            <p>{user.name}</p>
            {user.role === "ADMIN" ? <span>Admin</span> : null}
          </div>
          <button className="icon-button" type="button" onClick={logout} aria-label="Log out">
            <LogoutIcon />
          </button>
        </div>
      </header>

      <div className="workspace-shell">
        <aside className="sidebar">
          <nav className="nav-stack">
            {navItems.map((item) => {
              const IconComponent = item.icon;
              return (
                <button
                  key={item.key}
                  className={`nav-item ${activeSection === item.key ? "is-active" : ""}`}
                  type="button"
                  onClick={() => setActiveSection(item.key)}
                >
                  <IconComponent />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="content-shell">
          {sectionContent}
        </section>
      </div>

      <nav className="bottom-tabs">
        {navItems.map((item) => {
          const IconComponent = item.icon;
          return (
            <button
              key={item.key}
              className={`nav-item ${activeSection === item.key ? "is-active" : ""}`}
              type="button"
              onClick={() => setActiveSection(item.key)}
            >
              <IconComponent />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {error ? <div className="toast-note global-toast">{error}</div> : null}

      {lightbox ? (
        <div className="lightbox" role="dialog" aria-modal="true" onClick={() => setLightbox(null)}>
          <div className="lightbox-frame" onClick={(event) => event.stopPropagation()}>
            <div className="row-between lightbox-head">
              <span>{lightbox.title}</span>
              <button className="icon-button" type="button" onClick={() => setLightbox(null)} aria-label="Close lightbox">
                ×
              </button>
            </div>
            {lightbox.mimeType.startsWith("video/") ? (
              <video src={lightbox.url} controls autoPlay />
            ) : (
              <img src={lightbox.url} alt={lightbox.title} />
            )}
          </div>
        </div>
      ) : null}
    </main>
  );
};
