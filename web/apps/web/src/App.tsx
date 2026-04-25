import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";
import { api, setAuthToken, setCsrfToken } from "./api";
import { decryptBytes, decryptText, encryptBytes, encryptText } from "./crypto";
import { AuthUser, Journal, Marker, MeetingPost, PostMedia, Role } from "./types";

type JournalResponse = { journal: Journal };
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

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;

const toDataBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  return btoa(String.fromCharCode(...bytes));
};

const asGiB = (bytes: number): number => Math.round((bytes / 1024 / 1024 / 1024) * 100) / 100;

export const App = () => {
  const [token, setToken] = useState<string | null>(localStorage.getItem("mapories_token"));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);

  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  const [journals, setJournals] = useState<Journal[]>([]);
  const [selectedJournalId, setSelectedJournalId] = useState<string>("");
  const [journalName, setJournalName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [createdInvite, setCreatedInvite] = useState<string>("");

  const [meetingTitle, setMeetingTitle] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [locationName, setLocationName] = useState("");
  const [latitude, setLatitude] = useState("47.4979");
  const [longitude, setLongitude] = useState("19.0402");

  const [markers, setMarkers] = useState<Marker[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string>("");

  const [journalSecret, setJournalSecret] = useState("");
  const [postText, setPostText] = useState("");
  const [files, setFiles] = useState<File[]>([]);

  const [posts, setPosts] = useState<MeetingPost[]>([]);
  const [decryptedPosts, setDecryptedPosts] = useState<Record<string, string>>({});

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

  const onAuthSuccess = (auth: AuthResponse) => {
    setToken(auth.accessToken || auth.token);
    setAuthToken(auth.accessToken || auth.token);
    if (auth.csrfToken) {
      setCsrfToken(auth.csrfToken);
    }
  };

  useEffect(() => {
    setAuthToken(token);
    if (!token) {
      setUser(null);
      setJournals([]);
      setMarkers([]);
      return;
    }

    api
      .get<AuthUser>("/auth/me")
      .then((response) => {
        setUser(response.data);
      })
      .catch(() => {
        setToken(null);
        setAuthToken(null);
        setCsrfToken(null);
      });
  }, [token]);

  useEffect(() => {
    if (token || !GOOGLE_CLIENT_ID || !window.google || !googleButtonRef.current) {
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
      shape: "pill",
    });

    window.google.accounts.id.prompt();
  }, [token]);

  useEffect(() => {
    if (!user) {
      return;
    }

    api
      .get<JournalResponse[]>("/journals")
      .then((response) => {
        const next = response.data.map((item) => item.journal);
        setJournals(next);
        if (!selectedJournalId && next.length > 0) {
          setSelectedJournalId(next[0].id);
        }
      })
      .catch(() => setError("Could not load journals"));
  }, [user, selectedJournalId]);

  useEffect(() => {
    if (!selectedJournalId) {
      setMarkers([]);
      return;
    }

    api
      .get<Marker[]>(`/journals/${selectedJournalId}/markers`)
      .then((response) => {
        setMarkers(response.data);
      })
      .catch(() => setError("Could not load map markers"));
  }, [selectedJournalId]);

  const loadAdminData = async () => {
    if (user?.role !== "ADMIN") {
      return;
    }

    const [overview, users, plans] = await Promise.all([
      api.get<AdminOverview>("/admin/overview"),
      api.get<AdminUser[]>("/admin/users", { params: { query: adminQuery || undefined } }),
      api.get<Plan[]>("/admin/subscription-plans"),
    ]);

    setAdminOverview(overview.data);
    setAdminUsers(users.data);
    setAdminPlans(plans.data);
    if (!grantPlanId && plans.data.length > 0) {
      setGrantPlanId(plans.data[0].id);
    }
  };

  useEffect(() => {
    loadAdminData().catch(() => setError("Could not load admin data"));
  }, [user, adminQuery]);

  const selectedCenter = useMemo<[number, number]>(() => {
    if (!markers.length) {
      return [47.4979, 19.0402];
    }

    return [markers[0].latitude, markers[0].longitude];
  }, [markers]);

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
    if (!journalName.trim()) {
      return;
    }

    await api.post("/journals", { name: journalName });
    const response = await api.get<JournalResponse[]>("/journals");
    const next = response.data.map((item) => item.journal);
    setJournals(next);
    setJournalName("");
  };

  const joinJournal = async (event: FormEvent) => {
    event.preventDefault();
    if (!inviteCode.trim()) {
      return;
    }

    await api.post("/journals/join", { code: inviteCode.trim() });
    const response = await api.get<JournalResponse[]>("/journals");
    setJournals(response.data.map((item) => item.journal));
    setInviteCode("");
  };

  const createInvite = async () => {
    if (!selectedJournalId) {
      return;
    }

    const response = await api.post<{ code: string }>(
      `/journals/${selectedJournalId}/invites`,
      {},
    );
    setCreatedInvite(response.data.code);
  };

  const createMeeting = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedJournalId) {
      return;
    }

    await api.post(`/journals/${selectedJournalId}/meetings`, {
      title: meetingTitle,
      meetingAt: new Date(meetingDate).toISOString(),
      locationName,
      latitude: Number(latitude),
      longitude: Number(longitude),
    });

    const markersResponse = await api.get<Marker[]>(`/journals/${selectedJournalId}/markers`);
    setMarkers(markersResponse.data);

    setMeetingTitle("");
    setMeetingDate("");
    setLocationName("");
  };

  const loadPosts = async (meetingId: string) => {
    setSelectedMeetingId(meetingId);
    const response = await api.get<MeetingPost[]>(`/meetings/${meetingId}/posts`);
    setPosts(response.data);
  };

  const submitPost = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedMeetingId || !selectedJournalId || !journalSecret) {
      setError("Select a meeting and set a journal secret");
      return;
    }

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

    await api.post(`/meetings/${selectedMeetingId}/posts`, {
      ciphertextBase64: encryptedText.ciphertextBase64,
      ivBase64: encryptedText.ivBase64,
      algorithm: "AES-256-GCM",
      media,
    });

    setPostText("");
    setFiles([]);
    await loadPosts(selectedMeetingId);
  };

  const decryptLoadedPosts = async () => {
    if (!selectedJournalId || !journalSecret) {
      return;
    }

    const next: Record<string, string> = {};

    for (const post of posts) {
      try {
        next[post.id] = await decryptText(
          post.ciphertextBase64,
          post.ivBase64,
          journalSecret,
          selectedJournalId,
        );
      } catch {
        next[post.id] = "[Locked or wrong secret]";
      }
    }

    setDecryptedPosts(next);
  };

  const openDecryptedMedia = async (media: PostMedia) => {
    if (!selectedJournalId || !journalSecret) {
      return;
    }

    const response = await api.get<ArrayBuffer>(`/media/${media.id}`, {
      responseType: "arraybuffer",
    });

    const encryptedBytesBase64 = toDataBase64(response.data);
    const decryptedBytes = await decryptBytes(
      encryptedBytesBase64,
      media.nonceBase64,
      journalSecret,
      selectedJournalId,
    );

    const decryptedBuffer = decryptedBytes.buffer.slice(
      decryptedBytes.byteOffset,
      decryptedBytes.byteOffset + decryptedBytes.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([decryptedBuffer], { type: media.mimeType });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  const logout = async () => {
    try {
      await api.post("/auth/logout", {});
    } catch {
      // no-op
    }
    setToken(null);
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

    await loadAdminData();
  };

  const updateUserRole = async (userId: string, role: Role) => {
    await api.patch(`/admin/users/${userId}/role`, { role });
    await loadAdminData();
  };

  const updatePlanStatus = async (planId: string, isActive: boolean) => {
    await api.patch(`/admin/subscription-plans/${planId}`, { isActive });
    await loadAdminData();
  };

  const grantPackage = async (targetUserId: string) => {
    await api.post(`/admin/users/${targetUserId}/grant-package`, {
      planId: grantPlanId || undefined,
      daysValid: Number(grantDays),
      reason: grantReason,
      isComplimentary: true,
    });

    await loadAdminData();
  };

  if (!token || !user) {
    return (
      <main className="shell">
        <section className="panel">
          <h1>Mapories</h1>
          <p>Private map-journal where location markers are visible, stories unlock later.</p>

          <form className="stack" onSubmit={handleRegister}>
            <h2>Create account</h2>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" />
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password (min 12 chars)"
            />
            <button type="submit">Register</button>
          </form>

          <form className="stack" onSubmit={handleLogin}>
            <h2>Login</h2>
            <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email" />
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
            />
            <button type="submit">Login</button>
          </form>

          <div className="stack">
            <h2>Google one-click</h2>
            <div ref={googleButtonRef} />
          </div>

          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="panel row-between">
        <div>
          <h1>Mapories</h1>
          <p>
            Signed in as {user.name} ({user.role})
          </p>
        </div>
        <button onClick={logout}>Logout</button>
      </header>

      {user.role === "ADMIN" && (
        <section className="panel stack">
          <h2>Admin Platform</h2>
          {adminOverview ? (
            <p className="mono">
              Users {adminOverview.users} • Journals {adminOverview.journals} • Meetings {adminOverview.meetings} •
              Posts {adminOverview.posts} • Plans {adminOverview.plans}
            </p>
          ) : null}

          <div className="grid-two">
            <div className="stack">
              <h3>Pricing and plans</h3>
              <form className="stack" onSubmit={createPlan}>
                <input value={newPlanName} onChange={(event) => setNewPlanName(event.target.value)} placeholder="Plan name" />
                <select value={newPlanTier} onChange={(event) => setNewPlanTier(event.target.value as "FREE" | "PRO" | "TEAM")}>
                  <option value="FREE">FREE</option>
                  <option value="PRO">PRO</option>
                  <option value="TEAM">TEAM</option>
                </select>
                <input value={newPlanPrice} onChange={(event) => setNewPlanPrice(event.target.value)} placeholder="Price (cents/month)" />
                <input value={newPlanStorageGiB} onChange={(event) => setNewPlanStorageGiB(event.target.value)} placeholder="Upload limit in GiB" />
                <button type="submit">Create plan</button>
              </form>

              {adminPlans.map((plan) => (
                <article key={plan.id} className="card">
                  <p className="mono">{plan.name} ({plan.tier})</p>
                  <p className="mono">{(plan.priceCents / 100).toFixed(2)} / month</p>
                  <p className="mono">{asGiB(Number(plan.monthlyUploadLimitBytes))} GiB</p>
                  <button onClick={() => updatePlanStatus(plan.id, !plan.isActive)}>
                    {plan.isActive ? "Deactivate" : "Activate"}
                  </button>
                </article>
              ))}
            </div>

            <div className="stack">
              <h3>User management</h3>
              <input
                value={adminQuery}
                onChange={(event) => setAdminQuery(event.target.value)}
                placeholder="Search users by name/email"
              />
              <select value={grantPlanId} onChange={(event) => setGrantPlanId(event.target.value)}>
                <option value="">Custom free package</option>
                {adminPlans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.name}
                  </option>
                ))}
              </select>
              <input value={grantDays} onChange={(event) => setGrantDays(event.target.value)} placeholder="Grant days" />
              <input value={grantReason} onChange={(event) => setGrantReason(event.target.value)} placeholder="Grant reason" />

              {adminUsers.map((adminUser) => (
                <article key={adminUser.id} className="card">
                  <p className="mono">{adminUser.name} ({adminUser.email})</p>
                  <p className="mono">Current role: {adminUser.role}</p>
                  <div className="row-between">
                    <select
                      value={adminUser.role}
                      onChange={(event) => updateUserRole(adminUser.id, event.target.value as Role)}
                    >
                      <option value="USER">USER</option>
                      <option value="ARTIST">ARTIST</option>
                      <option value="MODERATOR">MODERATOR</option>
                      <option value="ADMIN">ADMIN</option>
                    </select>
                    <button onClick={() => grantPackage(adminUser.id)}>Grant package</button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="panel grid-two">
        <div className="stack">
          <h2>Journals</h2>
          <select
            value={selectedJournalId}
            onChange={(event) => {
              setSelectedJournalId(event.target.value);
              setSelectedMeetingId("");
              setPosts([]);
              setDecryptedPosts({});
            }}
          >
            <option value="">Pick a journal</option>
            {journals.map((journal) => (
              <option key={journal.id} value={journal.id}>
                {journal.name}
              </option>
            ))}
          </select>

          <form className="stack" onSubmit={createJournal}>
            <input
              value={journalName}
              onChange={(event) => setJournalName(event.target.value)}
              placeholder="New journal name"
            />
            <button type="submit">Create journal</button>
          </form>

          <form className="stack" onSubmit={joinJournal}>
            <input
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
              placeholder="Invite code"
            />
            <button type="submit">Join journal</button>
          </form>

          <button onClick={createInvite} disabled={!selectedJournalId}>
            Create invite
          </button>
          {createdInvite ? <p className="mono">Invite: {createdInvite}</p> : null}

          <h3>Journal secret</h3>
          <input
            type="password"
            value={journalSecret}
            onChange={(event) => setJournalSecret(event.target.value)}
            placeholder="Shared secret for E2EE"
          />
        </div>

        <div className="stack">
          <h2>Meetings</h2>
          <form className="stack" onSubmit={createMeeting}>
            <input
              value={meetingTitle}
              onChange={(event) => setMeetingTitle(event.target.value)}
              placeholder="Meeting title"
            />
            <input
              type="datetime-local"
              value={meetingDate}
              onChange={(event) => setMeetingDate(event.target.value)}
            />
            <input
              value={locationName}
              onChange={(event) => setLocationName(event.target.value)}
              placeholder="Location name"
            />
            <input
              value={latitude}
              onChange={(event) => setLatitude(event.target.value)}
              placeholder="Latitude"
            />
            <input
              value={longitude}
              onChange={(event) => setLongitude(event.target.value)}
              placeholder="Longitude"
            />
            <button type="submit" disabled={!selectedJournalId}>
              Save meeting marker
            </button>
          </form>

          <div className="map-wrap">
            <MapContainer center={selectedCenter} zoom={6} scrollWheelZoom style={{ height: "100%" }}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {markers.map((marker) => (
                <CircleMarker
                  key={marker.id}
                  center={[marker.latitude, marker.longitude]}
                  radius={8}
                  pathOptions={{ color: "#006d77", fillOpacity: 0.6 }}
                >
                  <Popup>
                    <strong>{marker.locationName}</strong>
                    <br />
                    {new Date(marker.meetingAt).toLocaleString()}
                    <br />
                    <button onClick={() => loadPosts(marker.id)}>Open meeting posts</button>
                  </Popup>
                </CircleMarker>
              ))}
            </MapContainer>
          </div>
        </div>
      </section>

      <section className="panel grid-two">
        <div className="stack">
          <h2>Post in meeting</h2>
          <p>Members can only read others after one-month anniversary. You can always read your own.</p>
          <p className="mono">Selected meeting: {selectedMeetingId || "None"}</p>

          <form className="stack" onSubmit={submitPost}>
            <textarea
              value={postText}
              onChange={(event) => setPostText(event.target.value)}
              placeholder="Your encrypted memory"
              rows={5}
            />
            <input
              type="file"
              multiple
              accept="image/*,video/*"
              onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
            />
            <button type="submit" disabled={!selectedMeetingId}>
              Encrypt and publish post
            </button>
          </form>
        </div>

        <div className="stack">
          <h2>Visible posts</h2>
          <button onClick={decryptLoadedPosts} disabled={!posts.length}>
            Decrypt loaded posts
          </button>
          {posts.map((post) => (
            <article key={post.id} className="card">
              <p className="mono">Post: {post.id}</p>
              <p className="mono">Author: {post.authorId}</p>
              <p className="mono">Visible after: {new Date(post.visibleAfter).toLocaleString()}</p>
              <p>{decryptedPosts[post.id] ?? "Encrypted content"}</p>

              {post.media.map((media) => (
                <button key={media.id} onClick={() => openDecryptedMedia(media)}>
                  Open media {media.mimeType} ({Math.round(media.sizeBytes / 1024)} KB)
                </button>
              ))}
            </article>
          ))}
        </div>
      </section>

      {error ? <p className="error">{error}</p> : null}
    </main>
  );
};
