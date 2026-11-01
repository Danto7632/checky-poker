import { useNavigate } from "react-router";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Coins, Menu, Crown, Settings, Plus, Target, Users, UserPlus, Swords, BookOpen, X, Lock, Unlock, LogOut, CheckCircle2, ShoppingBag, Info, Trophy, Timer, Volume2, Globe, ChevronRight
} from "lucide-react";
import {
  getCurrentAuth,
  getCurrentPreferredLanguage,
  getCurrentUserId,
  patchSessionUser,
  PreferredLanguage,
  signOut,
} from "../auth";
import { apiFetch } from "../api";
import {
  AUDIO_SETTINGS_UPDATED_EVENT,
  AudioSettings,
  getAudioSettings,
  setAudioSettings,
} from "../audio";
import { useI18n } from "../i18n";

type LobbyRoomType = "ai_bot" | "cash" | "tournament";

interface LobbyTableSummary {
  id: string;
  name: string;
  type: LobbyRoomType;
  status: string;
  hostUserId: string;
  blindSmall: number;
  blindBig: number;
  currentPlayers: number;
  humanPlayers: number;
  maxPlayers: number;
  isPrivate: boolean;
  hasBeenPublic: boolean;
  code?: string;
}

interface LobbyLeaderboardEntry {
  id: string;
  nickname: string;
  role: "guest" | "free" | "pro";
  balanceAmount: number;
}

interface LobbyTableItem {
  id: string;
  type: "bot" | "cash" | "tournament";
  name: string;
  stakes: string;
  players: number;
  max: number;
  isPrivate: boolean;
  status?: string;
  prizePool?: string;
  itm?: string;
  buyIn?: string;
  highlight?: boolean;
  code?: string;
}

interface ProfileAvatar {
  hairStyle: string;
  skinTone: string;
  hairColor: string;
  faceType: string;
  eyeType: string;
  mouthType: string;
  outfit: string;
  accessory?: string;
}

interface ProfileMeResponse {
  id: string;
  nickname: string;
  role: "guest" | "free" | "pro";
  preferredLanguage: PreferredLanguage;
  balanceAmount: number;
  avatar: ProfileAvatar;
  subscriptionActive: boolean;
  createdAt: string;
}

interface ProfileStatsResponse {
  playedHands: number;
  winHands: number;
  biggestPot: number;
  totalProfit: number;
  winRate: number;
}

interface SocialUserSummary {
  id: string;
  nickname: string;
  role: "guest" | "free" | "pro";
  isFriend?: boolean;
}

interface IncomingFriendRequest {
  id: string;
  requesterUserId: string;
  requesterNickname: string;
  createdAt: string;
}

interface OutgoingFriendRequest {
  id: string;
  targetUserId: string;
  targetNickname: string;
  createdAt: string;
}

interface SocialRoomInvite {
  id: string;
  roomId: string;
  roomName: string;
  roomType: LobbyRoomType;
  inviterUserId: string;
  inviterNickname: string;
  createdAt: string;
}

const AVATAR_TOP_OPTIONS = [
  { value: "shortFlat", label: "Short Flat" },
  { value: "shortCurly", label: "Short Curly" },
  { value: "straight01", label: "Straight" },
  { value: "longButNotTooLong", label: "Long" },
  { value: "bob", label: "Bob" },
  { value: "hat", label: "Hat" },
  { value: "hijab", label: "Hijab" },
  { value: "turban", label: "Turban" },
];

const AVATAR_OUTFIT_OPTIONS = [
  { value: "hoodie", label: "Hoodie" },
  { value: "blazerAndShirt", label: "Blazer Shirt" },
  { value: "blazerAndSweater", label: "Blazer Sweater" },
  { value: "graphicShirt", label: "Graphic Shirt" },
  { value: "shirtCrewNeck", label: "Crew Neck" },
  { value: "shirtVNeck", label: "V-Neck" },
];

const AVATAR_EYE_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "happy", label: "Happy" },
  { value: "wink", label: "Wink" },
  { value: "surprised", label: "Surprised" },
  { value: "squint", label: "Squint" },
];

const AVATAR_MOUTH_OPTIONS = [
  { value: "smile", label: "Smile" },
  { value: "default", label: "Default" },
  { value: "serious", label: "Serious" },
  { value: "sad", label: "Sad" },
  { value: "twinkle", label: "Twinkle" },
];

const AVATAR_FACE_OPTIONS = [
  { value: "default", label: "Default" },
  { value: "defaultNatural", label: "Natural" },
  { value: "raisedExcited", label: "Raised" },
  { value: "sadConcerned", label: "Concerned" },
  { value: "upDown", label: "Up/Down" },
];

const AVATAR_SKIN_COLORS = ["ffdbb4", "edb98a", "d08b5b", "ae5d29", "614335", "fd9841", "f8d25c"];
const AVATAR_HAIR_COLORS = ["2c1b18", "a55728", "724133", "d6b370", "c93305", "f59797", "e8e1e1"];

const LEGACY_HAIR_COLOR_MAP: Record<string, string> = {
  black: "2c1b18",
  blonde: "d6b370",
  brown: "724133",
  red: "c93305",
  pastelpink: "f59797",
  platinum: "e8e1e1",
};

const HEX_COLOR_REGEX = /^[a-fA-F0-9]{6}$/;

function hasOption(options: Array<{ value: string }>, value: string) {
  return options.some((option) => option.value === value);
}

function normalizeAvatarValue(avatar: ProfileAvatar) {
  const legacyHair = LEGACY_HAIR_COLOR_MAP[avatar.hairColor.toLowerCase()];
  const normalizedHair = HEX_COLOR_REGEX.test(avatar.hairColor)
    ? avatar.hairColor.toLowerCase()
    : legacyHair ?? "2c1b18";
  const normalizedSkin = HEX_COLOR_REGEX.test(avatar.skinTone)
    ? avatar.skinTone.toLowerCase()
    : "ffdbb4";

  return {
    top: hasOption(AVATAR_TOP_OPTIONS, avatar.hairStyle) ? avatar.hairStyle : "shortFlat",
    skinColor: AVATAR_SKIN_COLORS.includes(normalizedSkin) ? normalizedSkin : "ffdbb4",
    hairColor: AVATAR_HAIR_COLORS.includes(normalizedHair) ? normalizedHair : "2c1b18",
    face: hasOption(AVATAR_FACE_OPTIONS, avatar.faceType) ? avatar.faceType : "default",
    clothing: hasOption(AVATAR_OUTFIT_OPTIONS, avatar.outfit) ? avatar.outfit : "hoodie",
    mouth: hasOption(AVATAR_MOUTH_OPTIONS, avatar.mouthType) ? avatar.mouthType : "smile",
    eyes: hasOption(AVATAR_EYE_OPTIONS, avatar.eyeType) ? avatar.eyeType : "default",
  };
}

const fallbackTournamentTables: LobbyTableItem[] = [
  {
    id: "tournament-fallback",
    type: "tournament",
    name: "Sunday Live Tournament",
    stakes: "-",
    players: 72,
    max: 180,
    isPrivate: false,
    status: "Registering",
    buyIn: "TBD",
    prizePool: "TBD",
    itm: "TBD",
  },
];

function toLobbyTable(summary: LobbyTableSummary): LobbyTableItem {
  const mappedType: LobbyTableItem["type"] =
    summary.type === "ai_bot" ? "bot" : summary.type;
  const stakes =
    Number.isFinite(summary.blindSmall) && Number.isFinite(summary.blindBig)
      ? `${summary.blindSmall}/${summary.blindBig}`
      : "-";

  return {
    id: summary.id,
    type: mappedType,
    name: summary.name,
    stakes,
    players: summary.currentPlayers,
    max: summary.maxPlayers,
    isPrivate: summary.isPrivate,
    status: summary.status,
    code: summary.code,
    buyIn: summary.type === "tournament" ? "TBD" : undefined,
    prizePool: summary.type === "tournament" ? "TBD" : undefined,
    itm: summary.type === "tournament" ? "TBD" : undefined,
  };
}

export function Lobby() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState("QUICK PLAY");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [passwordModalTable, setPasswordModalTable] = useState<any | null>(null);
  const [spectateTournamentModal, setSpectateTournamentModal] = useState<any | null>(null);
  
  const [showMenu, setShowMenu] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showSocialModal, setShowSocialModal] = useState(false);
  const [showHelpSupportModal, setShowHelpSupportModal] = useState(false);
  const [profileTab, setProfileTab] = useState<"stats" | "avatar" | "settings">("stats");
  const [avatarOptions, setAvatarOptions] = useState({
    top: "shortFlat",
    skinColor: "ffdbb4",
    hairColor: "2c1b18",
    face: "default",
    clothing: "hoodie",
    mouth: "smile",
    eyes: "default"
  });
  const [tables, setTables] = useState<LobbyTableItem[]>([]);
  const [tableLoading, setTableLoading] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LobbyLeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileMe, setProfileMe] = useState<ProfileMeResponse | null>(null);
  const [profileStats, setProfileStats] = useState<ProfileStatsResponse | null>(null);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [profileBusy, setProfileBusy] = useState(false);
  const [settingsLanguage, setSettingsLanguage] = useState<PreferredLanguage>(
    getCurrentPreferredLanguage(),
  );
  const [audioSettings, setAudioSettingsState] = useState<AudioSettings>(() => getAudioSettings());
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [socialBusy, setSocialBusy] = useState(false);
  const [socialNotice, setSocialNotice] = useState("");
  const [friendSearch, setFriendSearch] = useState("");
  const [friendSearchResults, setFriendSearchResults] = useState<SocialUserSummary[]>([]);
  const [friends, setFriends] = useState<SocialUserSummary[]>([]);
  const [incomingFriendRequests, setIncomingFriendRequests] = useState<IncomingFriendRequest[]>([]);
  const [outgoingFriendRequests, setOutgoingFriendRequests] = useState<OutgoingFriendRequest[]>([]);
  const [roomInvites, setRoomInvites] = useState<SocialRoomInvite[]>([]);
  
  const { isLoggedIn, isPro, userName, balanceAmount } = getCurrentAuth();
  const currentUserId = getCurrentUserId();

  const navigateToRoom = (roomId: string, state?: Record<string, unknown>) => {
    const query = new URLSearchParams({ roomId }).toString();
    navigate(`/play?${query}`, {
      state: {
        ...(state ?? {}),
        roomId,
      },
    });
  };

  const applyAvatarOptions = (avatar: ProfileAvatar) => {
    setAvatarOptions(normalizeAvatarValue(avatar));
  };

  const loadProfile = async () => {
    if (!isLoggedIn) return;

    setProfileLoading(true);
    try {
      const [me, stats] = await Promise.all([
        apiFetch<ProfileMeResponse>("/profile/me"),
        apiFetch<ProfileStatsResponse>("/profile/stats"),
      ]);

      setProfileMe(me);
      setProfileStats(stats);
      applyAvatarOptions(me.avatar);
      setSettingsLanguage(me.preferredLanguage ?? "en");
      patchSessionUser({ preferredLanguage: me.preferredLanguage ?? "en" });
      setProfileError("");
    } catch (error) {
      setProfileError(
        error instanceof Error
          ? error.message
          : t("Failed to load profile information."),
      );
    } finally {
      setProfileLoading(false);
    }
  };

  const saveAvatar = async () => {
    if (!isLoggedIn) return;

    setProfileBusy(true);
    try {
      await apiFetch("/profile/avatar", {
        method: "PATCH",
        body: JSON.stringify({
          hairStyle: avatarOptions.top,
          skinTone: avatarOptions.skinColor,
          hairColor: avatarOptions.hairColor,
          faceType: avatarOptions.face,
          eyeType: avatarOptions.eyes,
          mouthType: avatarOptions.mouth,
          outfit: avatarOptions.clothing,
        }),
      });

      await loadProfile();
      setProfileTab("stats");
    } catch (error) {
      alert(error instanceof Error ? error.message : t("Failed to save avatar."));
    } finally {
      setProfileBusy(false);
    }
  };

  const updatePassword = async () => {
    if (!isLoggedIn) return;

    if (!passwordForm.currentPassword || !passwordForm.newPassword) {
      alert(t("Enter current and new password."));
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      alert(t("Password confirmation does not match."));
      return;
    }

    setProfileBusy(true);
    try {
      await apiFetch("/profile/password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      });

      setPasswordForm({
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
      });
      setProfileTab("stats");
      alert(t("Password has been updated."));
    } catch (error) {
      alert(error instanceof Error ? error.message : t("Failed to update password."));
    } finally {
      setProfileBusy(false);
    }
  };

  const saveSettings = async () => {
    const appliedAudio = setAudioSettings(audioSettings);
    setAudioSettingsState(appliedAudio);

    if (!isLoggedIn) {
      setShowSettingsModal(false);
      return;
    }

    setSettingsBusy(true);
    try {
      const updated = await apiFetch<{ preferredLanguage: PreferredLanguage }>(
        "/profile/preferences",
        {
          method: "PATCH",
          body: JSON.stringify({ preferredLanguage: settingsLanguage }),
        },
      );

      patchSessionUser({ preferredLanguage: updated.preferredLanguage });
      setProfileMe((prev) =>
        prev
          ? {
              ...prev,
              preferredLanguage: updated.preferredLanguage,
            }
          : prev,
      );
      setShowSettingsModal(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : t("Failed to save settings."));
    } finally {
      setSettingsBusy(false);
    }
  };

  const loadTables = async () => {
    setTableLoading(true);
    try {
      const list = await apiFetch<LobbyTableSummary[]>("/lobby/tables");
      const mapped = Array.isArray(list) ? list.map(toLobbyTable) : [];
      const hasTournament = mapped.some((table) => table.type === "tournament");
      setTables(hasTournament ? mapped : [...mapped, ...fallbackTournamentTables]);
    } catch {
      setTables([...fallbackTournamentTables]);
    } finally {
      setTableLoading(false);
    }
  };

  const loadLeaderboard = async () => {
    setLeaderboardLoading(true);
    try {
      const ranking = await apiFetch<LobbyLeaderboardEntry[]>('/lobby/leaderboard');
      setLeaderboard(Array.isArray(ranking) ? ranking : []);
    } catch {
      setLeaderboard([]);
    } finally {
      setLeaderboardLoading(false);
    }
  };

  const loadSocial = async () => {
    if (!isLoggedIn) {
      setFriends([]);
      setIncomingFriendRequests([]);
      setOutgoingFriendRequests([]);
      setRoomInvites([]);
      return;
    }

    setSocialBusy(true);
    try {
      const [friendsData, friendRequestData, inviteData] = await Promise.all([
        apiFetch<SocialUserSummary[]>("/social/friends"),
        apiFetch<{ incoming: IncomingFriendRequest[]; outgoing: OutgoingFriendRequest[] }>("/social/friend-requests"),
        apiFetch<SocialRoomInvite[]>("/social/room-invites"),
      ]);

      setFriends(Array.isArray(friendsData) ? friendsData : []);
      setIncomingFriendRequests(
        Array.isArray(friendRequestData?.incoming) ? friendRequestData.incoming : [],
      );
      setOutgoingFriendRequests(
        Array.isArray(friendRequestData?.outgoing) ? friendRequestData.outgoing : [],
      );
      setRoomInvites(Array.isArray(inviteData) ? inviteData : []);
      setSocialNotice("");
    } catch (error) {
      setSocialNotice(error instanceof Error ? error.message : t("Failed to load social data."));
    } finally {
      setSocialBusy(false);
    }
  };

  const handleSearchUsers = async () => {
    if (!isLoggedIn) return;
    const query = friendSearch.trim();
    if (!query) {
      setFriendSearchResults([]);
      return;
    }

    setSocialBusy(true);
    try {
      const results = await apiFetch<SocialUserSummary[]>(
        `/social/users?q=${encodeURIComponent(query)}`,
      );
      setFriendSearchResults(Array.isArray(results) ? results : []);
      setSocialNotice("");
    } catch (error) {
      setSocialNotice(error instanceof Error ? error.message : t("Failed to search users."));
    } finally {
      setSocialBusy(false);
    }
  };

  const handleSendFriendRequest = async (targetNickname: string) => {
    if (!isLoggedIn) return;

    setSocialBusy(true);
    try {
      await apiFetch("/social/friend-requests", {
        method: "POST",
        body: JSON.stringify({ targetNickname }),
      });
      setSocialNotice(t("Friend request sent."));
      await loadSocial();
    } catch (error) {
      setSocialNotice(error instanceof Error ? error.message : t("Failed to send friend request."));
    } finally {
      setSocialBusy(false);
    }
  };

  const handleRespondFriendRequest = async (requestId: string, accept: boolean) => {
    if (!isLoggedIn) return;

    setSocialBusy(true);
    try {
      await apiFetch(`/social/friend-requests/${requestId}/${accept ? "accept" : "decline"}`, {
        method: "POST",
      });
      setSocialNotice(accept ? t("Friend request accepted.") : t("Friend request declined."));
      await loadSocial();
    } catch (error) {
      setSocialNotice(error instanceof Error ? error.message : t("Failed to process friend request."));
    } finally {
      setSocialBusy(false);
    }
  };

  const handleRespondRoomInvite = async (inviteId: string, accept: boolean) => {
    if (!isLoggedIn) return;

    setSocialBusy(true);
    try {
      if (accept) {
        const room = await apiFetch<{ id: string; type: LobbyRoomType }>(
          `/social/room-invites/${inviteId}/accept`,
          { method: "POST" },
        );

        navigateToRoom(room.id, {
          mode: room.type === "ai_bot" ? "bot" : room.type,
          allowStartControl: false,
        });
        setShowSocialModal(false);
      } else {
        await apiFetch(`/social/room-invites/${inviteId}/decline`, { method: "POST" });
      }

      await loadSocial();
    } catch (error) {
      setSocialNotice(error instanceof Error ? error.message : t("Failed to process invite."));
    } finally {
      setSocialBusy(false);
    }
  };

  useEffect(() => {
    void loadTables();
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      void loadProfile();
    }
  }, [isLoggedIn]);

  useEffect(() => {
    if (showProfileModal && isLoggedIn) {
      void loadProfile();
    }
  }, [showProfileModal, isLoggedIn]);

  useEffect(() => {
    if (!showSettingsModal) return;

    setAudioSettingsState(getAudioSettings());
    if (isLoggedIn) {
      void loadProfile();
    }
  }, [showSettingsModal, isLoggedIn]);

  useEffect(() => {
    if (!showSocialModal || !isLoggedIn) return;
    void loadSocial();
  }, [showSocialModal, isLoggedIn]);

  useEffect(() => {
    const syncAudio = () => {
      setAudioSettingsState(getAudioSettings());
    };

    window.addEventListener(AUDIO_SETTINGS_UPDATED_EVENT, syncAudio as EventListener);
    window.addEventListener("storage", syncAudio);

    return () => {
      window.removeEventListener(AUDIO_SETTINGS_UPDATED_EVENT, syncAudio as EventListener);
      window.removeEventListener("storage", syncAudio);
    };
  }, []);

  useEffect(() => {
    if (activeTab === 'LEADERBOARD') {
      void loadLeaderboard();
    }
  }, [activeTab]);

  const gameModes = [
    {
      id: "ai-bot",
      title: t("AI Bot Training"),
      icon: <Swords className="w-8 h-8 text-white" />,
      color: "from-blue-500 to-cyan-500",
      description: t("Practice against AI opponents"),
    },
    {
      id: "cash-game",
      title: t("Cash Game"),
      icon: <Coins className="w-8 h-8 text-white" />,
      color: "from-green-500 to-emerald-500",
      description: t("Join public cash tables"),
    },
    {
      id: "tournament",
      title: t("Tournament"),
      icon: <Crown className="w-8 h-8 text-white" />,
      color: "from-purple-500 to-fuchsia-500",
      description: t("Compete for the top prize"),
      locked: !isLoggedIn,
    },
    {
      id: "review",
      title: t("Hand Review"),
      icon: <BookOpen className="w-8 h-8 text-white" />,
      color: "from-orange-500 to-amber-500",
      description: t("Analyze your past games"),
      locked: !isPro,
    },
  ];

  const handleTableClick = async (table: LobbyTableItem) => {
    if (table.type === "tournament" && !isLoggedIn) {
      alert(t("Guest cannot enter tournaments."));
      return;
    }

    if (table.players >= table.max) {
      navigateToRoom(table.id, {
        mode: table.type,
        table,
        spectate: true,
        allowStartControl: false,
      });
      return;
    }

    if (table.isPrivate) {
      setPasswordModalTable(table);
      setJoinCode(table.code ?? "");
    } else {
      try {
        await apiFetch(`/rooms/${table.id}/join-public`, { method: "POST" });
        navigateToRoom(table.id, {
          mode: table.type,
          table,
          spectate: false,
          allowStartControl: false,
        });
      } catch (error) {
        alert(error instanceof Error ? error.message : t("Failed to join table."));
      }
    }
  };

  const handleGameModeClick = async (id: string) => {
    if (id === "review") {
      if (!isPro) {
        alert(t("Hand Review is available for PRO members only."));
        return;
      }
      navigate("/review");
      return;
    }

    if (id === "tournament" && !isLoggedIn) {
      alert(t("Guest cannot play tournaments."));
      return;
    }

    const roomType: LobbyRoomType =
      id === "ai-bot" ? "ai_bot" : id === "tournament" ? "tournament" : "cash";

    try {
      const result = await apiFetch<{ matched: boolean; roomId?: string; reason?: string }>(
        "/lobby/quick-play",
        {
          method: "POST",
          body: JSON.stringify({ roomType }),
        },
      );

      if (!result.matched || !result.roomId) {
        alert(result.reason ?? t("No matching room available."));
        return;
      }

      navigateToRoom(result.roomId, {
        mode: id === "ai-bot" ? "bot" : id,
        allowStartControl: false,
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : t("Failed to connect quick play."));
    }
  };

  const tournaments = tables.filter((t) => t.type === "tournament");
  const cashGames = tables.filter((t) => t.type === "cash");
  const botGames = tables.filter((t) => t.type === "bot");
  const walletAmount = isLoggedIn
    ? (profileMe?.balanceAmount ?? balanceAmount)
    : 1000;
  const avatarSeed = isLoggedIn ? (profileMe?.nickname ?? userName) : "Guest";
  const avatarPreviewUrl =
    `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(avatarSeed)}` +
    `&top=${encodeURIComponent(avatarOptions.top)}` +
    `&skinColor=${encodeURIComponent(avatarOptions.skinColor)}` +
    `&hairColor=${encodeURIComponent(avatarOptions.hairColor)}` +
    `&clothing=${encodeURIComponent(avatarOptions.clothing)}` +
    `&mouth=${encodeURIComponent(avatarOptions.mouth)}` +
    `&eyes=${encodeURIComponent(avatarOptions.eyes)}` +
    `&eyebrows=${encodeURIComponent(avatarOptions.face)}`;

  return (
    <div className="flex flex-col w-full h-full bg-[#1A1B41] font-sans text-white relative overflow-hidden select-none">
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10 pointer-events-none" />

      {/* Top Navigation Bar */}
      <header className="relative z-10 flex items-center justify-between p-4 bg-[#11122D] shadow-md border-b border-white/5">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Menu 
              className="w-8 h-8 cursor-pointer hover:text-cyan-400 transition" 
              onClick={() => setShowMenu(true)}
            />
            <img
              src="/main.png"
              alt="AIPOT logo"
              className="h-8 w-8 rounded-full border border-cyan-300/30 object-cover"
            />
            <h1 className="text-2xl font-black italic tracking-wider">AIPOT</h1>
          </div>
          <button 
            onClick={() => setActiveTab("QUESTS")}
            className="hidden md:flex items-center gap-2 px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-full font-bold shadow-inner border border-indigo-400/30 transition"
          >
            <Target className="w-4 h-4 text-cyan-300" />
            <span>{t("Daily Missions")}</span>
          </button>
        </div>

        <div className="flex items-center gap-4">
          <div 
            onClick={() => setShowProfileModal(true)}
            className={`flex items-center rounded-full pr-4 pl-1 py-1 border border-white/10 transition cursor-pointer hover:bg-white/5 ${isLoggedIn ? 'bg-cyan-900/30' : 'bg-[#242754]'}`}
          >
            <div className={`${isLoggedIn ? 'bg-cyan-500' : 'bg-slate-500'} p-1.5 rounded-full mr-2`}>
              <Users className="w-4 h-4 text-white" />
            </div>
            <span className="font-mono font-bold text-sm">{isLoggedIn ? userName : "Guest"}</span>
          </div>

          <div 
            onClick={() => navigate("/store")}
            className="flex items-center bg-gradient-to-r from-yellow-600 to-yellow-500 rounded-full pr-2 pl-2 py-1 shadow-lg border border-yellow-400 cursor-pointer hover:scale-105 transition-transform"
          >
            <Coins className="w-5 h-5 text-white mr-2" />
            <span className="font-black text-lg text-white">${walletAmount.toLocaleString()}</span>
            <button className="ml-3 bg-green-500 hover:bg-green-400 p-1 rounded-full shadow-inner transition">
              <Plus className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden z-10 p-4 md:p-6 gap-6 relative">
        {/* Left Sidebar */}
        <aside className="w-64 flex flex-col gap-4 shrink-0 hidden md:flex">
          <div className="bg-[#242754] rounded-2xl p-4 flex flex-col gap-3 border border-white/5 shadow-xl">
            <h2 className="text-center font-bold text-slate-300 text-sm tracking-widest mb-2">{t("Customize")}</h2>
            
            <button 
              onClick={() => {
                if (!isLoggedIn) {
                  alert(t("Guest cannot create tables."));
                  return;
                }
                setShowCreateModal(true);
              }}
              className={`w-full font-black py-4 rounded-xl transition-all flex justify-center items-center gap-2 uppercase ${!isLoggedIn ? 'bg-slate-700 text-slate-400 shadow-[0_4px_0_#334155] opacity-80' : 'bg-gradient-to-b from-yellow-400 to-orange-500 text-white shadow-[0_4px_0_#B45309] hover:translate-y-1 hover:shadow-[0_0px_0_#B45309]'}`}
            >
              {!isLoggedIn ? <Lock className="w-5 h-5" /> : <Users className="w-5 h-5" />}
              {t("Create Table")}
            </button>
            <button
              onClick={() => {
                if (!isLoggedIn) {
                  alert(t("Sign in to use social features."));
                  return;
                }
                setShowSocialModal(true);
              }}
              className={`w-full font-black py-3 rounded-xl transition-all flex justify-center items-center gap-2 uppercase ${!isLoggedIn ? 'bg-slate-700 text-slate-400 shadow-[0_4px_0_#334155] opacity-80' : 'bg-gradient-to-b from-cyan-500 to-blue-600 text-white shadow-[0_4px_0_#1D4ED8] hover:translate-y-1 hover:shadow-[0_0px_0_#1D4ED8]'}`}
            >
              {!isLoggedIn ? <Lock className="w-5 h-5" /> : <UserPlus className="w-5 h-5" />}
              {t("Friends")}
            </button>
            <p className="text-xs text-center text-slate-400 font-medium px-2 mt-2">
              {t("Create a custom table and invite friends to play securely.")}
            </p>
          </div>

          <div 
            onClick={() => navigate("/store")}
            className="mt-auto bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl p-4 shadow-lg border border-white/10 relative overflow-hidden group cursor-pointer"
          >
             <div className="absolute -right-4 -top-4 w-24 h-24 bg-white/20 rounded-full blur-xl group-hover:scale-150 transition-transform"></div>
             <p className="text-xs font-bold text-cyan-300 uppercase mb-1">{t("PRO Bundle")}</p>
             <h3 className="font-black text-lg leading-tight">{t("Get 2x Chips & Ad-free")}</h3>
             <button className="mt-3 bg-white text-indigo-900 font-bold px-4 py-1.5 rounded-full text-sm hover:bg-slate-200 w-full transition shadow-md">{t("Store")}</button>
          </div>
        </aside>

        {/* Center Panel */}
        <main className="flex-1 bg-[#242754] rounded-2xl border border-white/5 shadow-xl flex flex-col overflow-hidden relative">
          <div className="flex bg-[#1A1C3E] border-b border-white/10 shrink-0 overflow-x-auto no-scrollbar">
            {[("QUICK PLAY"), ("TABLES"), ("LEADERBOARD"), ("QUESTS")].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-4 font-bold text-sm md:text-base tracking-wider transition-colors min-w-[120px] ${
                  activeTab === tab
                    ? "text-white bg-[#242754] border-t-2 border-cyan-400"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {tab === "QUICK PLAY"
                  ? t("Quick Play")
                  : tab === "TABLES"
                    ? t("Tables")
                    : tab === "LEADERBOARD"
                      ? t("Leaderboard")
                      : t("Quests")}
              </button>
            ))}
          </div>

          <div className="flex-1 p-4 md:p-6 overflow-y-auto">
            {/* QUICK PLAY */}
            {activeTab === "QUICK PLAY" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-full pb-8">
                {gameModes.map((mode, idx) => (
                  <motion.div
                    key={mode.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.1 }}
                    whileHover={{ scale: (mode as any).locked ? 1 : 1.02 }}
                    whileTap={{ scale: (mode as any).locked ? 1 : 0.98 }}
                    onClick={() => {
                      if ((mode as any).locked) {
                        alert(t("Guest cannot use this feature."));
                        return;
                      }
                      handleGameModeClick(mode.id);
                    }}
                    className={`cursor-pointer group relative rounded-2xl p-6 flex flex-col justify-end min-h-[160px] overflow-hidden shadow-lg bg-gradient-to-br ${mode.color} border-2 border-transparent ${(mode as any).locked ? 'opacity-75 grayscale sepia' : 'hover:border-white/50'} transition-all`}
                  >
                    <div className="absolute -right-6 -top-6 w-32 h-40 bg-white/10 rounded-xl rotate-12 backdrop-blur-sm group-hover:rotate-6 transition-transform flex items-center justify-center shadow-2xl">
                       {mode.icon}
                    </div>
                    {(mode as any).locked && (
                      <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-20 backdrop-blur-sm">
                        <div className="flex flex-col items-center gap-2">
                          <Lock className="w-8 h-8 text-white" />
                          <span className="text-white font-bold text-sm tracking-wider uppercase">{t("PRO Only")}</span>
                        </div>
                      </div>
                    )}
                    <h3 className="text-2xl font-black drop-shadow-md z-10">{mode.title}</h3>
                    <p className="text-sm font-semibold text-white/80 drop-shadow-sm z-10">{mode.description}</p>
                  </motion.div>
                ))}
              </div>
            )}
            
            {/* TABLES */}
            {activeTab === "TABLES" && (
              <div className="flex flex-col gap-6">
                {tournaments.length > 0 && (
                  <div className="flex flex-col gap-3">
                    <h2 className="text-xl font-black text-white flex items-center gap-2">
                      <Trophy className="text-yellow-400" /> {t("Live Tournaments")}
                    </h2>
                    {tournaments.map((table, idx) => (
                      <motion.div 
                        key={table.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        onClick={() => {
                          if (!isLoggedIn) return;
                          handleTableClick(table);
                        }}
                        className={`flex flex-col md:flex-row md:items-center justify-between p-1 rounded-xl transition-transform shadow-lg group ${!isLoggedIn ? 'bg-slate-700 opacity-60 cursor-not-allowed' : 'bg-gradient-to-r from-yellow-600 to-orange-600 cursor-pointer hover:scale-[1.01]'}`}
                      >
                        <div className="flex-1 bg-[#11122D] rounded-lg p-4 flex items-center justify-between">
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <Crown className="w-5 h-5 text-yellow-500" />
                              <span className="font-black text-xl text-yellow-400">{table.name}</span>
                            </div>
                            <div className="flex items-center gap-3 text-sm font-semibold text-slate-300">
                              <span className="flex items-center gap-1"><Coins className="w-3.5 h-3.5"/> Buy-in: {table.buyIn}</span>
                              <span className="text-slate-500">•</span>
                              <span className="flex items-center gap-1 text-green-400"><Timer className="w-3.5 h-3.5"/> {table.status}</span>
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-xs font-bold">
                              <div className="bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded border border-yellow-500/30 flex items-center gap-1">
                                <Trophy className="w-3 h-3" /> Prize: {table.prizePool}
                              </div>
                              <div className="bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded border border-cyan-500/30 flex items-center gap-1">
                                <Target className="w-3 h-3" /> ITM: {table.itm}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="flex flex-col items-end">
                              <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">{t("Entries")}</span>
                              <div className="flex items-center gap-1.5 font-mono text-sm font-bold text-white">
                                <Users className="w-4 h-4 text-slate-400"/>
                                {table.players}/{table.max}
                              </div>
                            </div>
                            <div className="hidden md:flex gap-2">
                               <button 
                                 onClick={(e) => { 
                                   e.stopPropagation(); 
                                   if (!isLoggedIn) {
                                     alert(t("Guest cannot watch tournaments."));
                                     return;
                                   }
                                   setSpectateTournamentModal(table); 
                                 }}
                                 className={`px-6 py-2 rounded-lg font-black uppercase tracking-wider text-sm shadow-md transition ${!isLoggedIn ? 'bg-slate-700 text-slate-500 opacity-70 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-500 text-white hover:shadow-[0_0_15px_rgba(147,51,234,0.5)]'}`}
                               >
                                {!isLoggedIn ? <Lock className="w-4 h-4 mx-auto" /> : t("Watch")}
                               </button>
                               <button 
                                 onClick={(e) => { 
                                   e.stopPropagation(); 
                                   if (!isLoggedIn) {
                                     alert(t("Guest cannot enter tournaments."));
                                     return;
                                   }
                                   handleTableClick(table); 
                                 }}
                                 className={`px-6 py-2 rounded-lg font-black uppercase tracking-wider text-sm shadow-md transition ${!isLoggedIn ? 'bg-slate-700 text-slate-500 opacity-70 cursor-not-allowed' : 'bg-gradient-to-b from-yellow-400 to-orange-500 text-white hover:shadow-[0_0_15px_rgba(250,204,21,0.5)]'}`}
                               >
                                {!isLoggedIn ? <Lock className="w-4 h-4 mx-auto" /> : t("Enter")}
                               </button>
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}

                <div className="flex flex-col gap-3 mt-6">
                  <div className="flex justify-between items-center mb-1">
                    <h2 className="text-xl font-black text-white flex items-center gap-2"><Target className="text-cyan-400 w-5 h-5"/>{t("AI Bot Games")}</h2>
                  </div>
                  {botGames.map((table, idx) => (
                      <motion.div 
                        key={table.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        onClick={() => handleTableClick(table)}
                        className="flex items-center justify-between p-4 rounded-xl border bg-gradient-to-r from-indigo-900/40 to-blue-900/40 border-indigo-500/50 hover:border-cyan-400/80 cursor-pointer hover:from-indigo-800/60 hover:to-blue-800/60 transition-all group"
                      >
                      <div className="flex flex-col gap-1">
                         <div className="flex items-center gap-2">
                           <span className="font-bold text-lg text-cyan-50">{table.name}</span>
                         </div>
                         <span className="text-sm font-semibold text-slate-400">{t("Blinds")}: {table.stakes}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5 bg-black/40 px-3 py-1 rounded-full border border-white/5">
                          <Users className="w-4 h-4 text-slate-300"/>
                          <span className="font-mono text-sm font-bold text-slate-200">{table.players}/{table.max}</span>
                        </div>
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleTableClick(table); }}
                          className="hidden md:block px-6 py-2 rounded-lg font-bold uppercase tracking-wider text-sm shadow-md transition bg-cyan-600 hover:bg-cyan-500 text-white group-hover:shadow-[0_0_15px_rgba(6,182,212,0.6)]"
                        >
                          {t("Practice")}
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>

                <div className="flex flex-col gap-3 mt-4">
                  <div className="flex justify-between items-center mb-1">
                    <h2 className="text-xl font-black text-white flex items-center gap-2"><Coins className="text-green-400 w-5 h-5"/> {t("Cash Games")}</h2>
                    <button
                      onClick={() => {
                        void loadTables();
                      }}
                      className="text-cyan-400 text-sm font-bold hover:text-cyan-300"
                    >
                      {tableLoading ? t("Loading...") : t("Refresh")}
                    </button>
                  </div>
                  
                  {cashGames.map((table, idx) => (
                      <motion.div 
                        key={table.id}
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        onClick={() => handleTableClick(table)}
                        className={`flex items-center justify-between p-4 rounded-xl border ${table.players >= table.max ? 'bg-[#1A1C3E] border-purple-500/30 hover:border-purple-500/70 cursor-pointer group transition-all' : 'bg-[#1A1C3E] border-white/10 hover:border-cyan-500/50 cursor-pointer hover:bg-[#1f224a] transition-all group'}`}
                      >
                      <div className="flex flex-col gap-1">
                         <div className="flex items-center gap-2">
                           {table.isPrivate ? <Lock className="w-4 h-4 text-red-400" /> : <Unlock className="w-4 h-4 text-green-400" />}
                           <span className="font-bold text-lg">{table.name}</span>
                         </div>
                         <span className="text-sm font-semibold text-slate-400">{t("Blinds")}: {table.stakes}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1.5 bg-black/40 px-3 py-1 rounded-full border border-white/5">
                          <Users className="w-4 h-4 text-slate-300"/>
                          <span className="font-mono text-sm font-bold text-slate-200">{table.players}/{table.max}</span>
                        </div>
                        <button 
                          onClick={(e) => { e.stopPropagation(); handleTableClick(table); }}
                          className={`hidden md:block px-6 py-2 rounded-lg font-bold uppercase tracking-wider text-sm shadow-md transition ${table.players >= table.max ? 'bg-purple-600 hover:bg-purple-500 text-white shadow-[0_0_15px_rgba(147,51,234,0.4)]' : 'bg-cyan-600 hover:bg-cyan-500 text-white group-hover:shadow-[0_0_15px_rgba(6,182,212,0.4)]'}`}
                        >
                          {table.players >= table.max ? t("Watch") : t("Join")}
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}

            {/* LEADERBOARD */}
            {activeTab === "LEADERBOARD" && (
              <div className="flex flex-col gap-3">
                 <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-black text-white">{t("Top Players")}</h2>
                    <button
                      onClick={() => {
                        void loadLeaderboard();
                      }}
                      className="text-xs font-bold text-cyan-400 bg-[#11122D] px-3 py-1 rounded-full hover:text-cyan-300"
                    >
                      {leaderboardLoading ? t('Loading...') : t('Refresh')}
                    </button>
                 </div>

                 <div className="flex flex-col gap-2">
                   {leaderboard.length === 0 ? (
                     <div className="bg-[#11122D] border border-white/10 rounded-2xl p-6 text-slate-300">
                       <p className="font-bold text-white">{t("No ranking data available.")}</p>
                     </div>
                   ) : (
                     leaderboard.slice(0, 20).map((entry, index) => (
                       <div
                         key={entry.id}
                         className={`relative rounded-xl p-4 flex items-center justify-between ${entry.id === currentUserId ? "bg-cyan-900/35 border border-cyan-400/70" : "bg-[#11122D] border border-white/10"}`}
                       >
                         {entry.id === currentUserId && (
                          <span className="absolute -top-2 right-3 text-[10px] px-2 py-0.5 rounded-full bg-cyan-400 text-slate-900 font-black">{t("YOU")}</span>
                         )}
                         <div className="flex items-center gap-3">
                           <div className={`w-9 h-9 rounded-full flex items-center justify-center font-black ${
                             index === 0
                               ? 'bg-yellow-500 text-slate-900'
                               : index === 1
                                 ? 'bg-slate-300 text-slate-900'
                                 : index === 2
                                   ? 'bg-amber-700 text-white'
                                   : 'bg-slate-700 text-white'
                           }`}>
                             {index + 1}
                           </div>
                           <div className="flex flex-col">
                             <span className="font-black text-white">{entry.nickname}</span>
                             <span className="text-xs uppercase tracking-wider text-slate-400">{entry.role}</span>
                           </div>
                         </div>
                         <div className="font-black text-cyan-300">${entry.balanceAmount.toLocaleString()}</div>
                       </div>
                     ))
                   )}
                 </div>
              </div>
            )}

            {/* QUESTS */}
            {activeTab === "QUESTS" && (
              <div className="flex flex-col gap-4">
                 <div className="flex justify-between items-center mb-2">
                    <h2 className="text-xl font-black text-white flex items-center gap-2">
                      <Target className="text-cyan-400" /> {t("Daily Missions")}
                    </h2>
                    <span className="text-sm font-bold text-slate-400">{t("Dummy Missions")}</span>
                 </div>

                 <div className="bg-[#11122D] border border-white/10 rounded-2xl p-4 flex items-center justify-between">
                   <div>
                     <p className="font-black text-white">{t("Play 3 Hands")}</p>
                     <p className="text-sm text-slate-400">0 / 3 {t("hands")}</p>
                   </div>
                   <div className="text-cyan-300 font-bold">+ 300</div>
                 </div>

                 <div className="bg-[#11122D] border border-white/10 rounded-2xl p-4 flex items-center justify-between">
                   <div>
                     <p className="font-black text-white">{t("Win 1 Hand")}</p>
                     <p className="text-sm text-slate-400">0 / 1 {t("wins")}</p>
                   </div>
                   <div className="text-cyan-300 font-bold">+ 500</div>
                 </div>

                 <div className="bg-[#11122D] border border-white/10 rounded-2xl p-4 flex items-center justify-between">
                   <div>
                     <p className="font-black text-white">{t("Join Cash Table")}</p>
                     <p className="text-sm text-slate-400">0 / 1 {t("joined")}</p>
                   </div>
                   <div className="text-cyan-300 font-bold">+ 200</div>
                 </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* CREATE MODAL */}
      <AnimatePresence>
        {showCreateModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-[#242754] w-full max-w-md rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
            >
              <div className="bg-[#1A1C3E] p-4 flex justify-between items-center border-b border-white/5">
                <h3 className="text-xl font-black uppercase tracking-wider flex items-center gap-2">
                  <Users className="text-yellow-400 w-6 h-6"/> {t("Create Table")}
                </h3>
                <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white transition">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="p-6">
                <div className="flex flex-col gap-4">
                  <div>
                    <label className="block text-sm font-bold text-slate-300 mb-1">{t("Game Mode")}</label>
                    <select id="createTableMode" className="w-full bg-[#11122D] border border-white/10 rounded-lg p-3 text-white font-bold outline-none focus:border-cyan-500 transition">
                      <option value="ai-bot">{t("AI Bot Training (No Money Risk)")}</option>
                      <option value="cash">{t("Cash Game")}</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-slate-300 mb-1">{t("Max Table Size")}</label>
                    <select id="createTableMax" defaultValue="8" className="w-full bg-[#11122D] border border-white/10 rounded-lg p-3 text-white font-bold outline-none focus:border-cyan-500 transition">
                      <option value="8">{t("8 Players")}</option>
                      <option value="6">{t("6 Players")}</option>
                      <option value="4">{t("4 Players")}</option>
                      <option value="2">{t("2 Players (Heads Up)")}</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-bold text-slate-300 mb-1">{t("Small Blind")}</label>
                      <input
                        id="createBlindSmall"
                        type="number"
                        min={1}
                        defaultValue={50}
                        className="w-full bg-[#11122D] border border-white/10 rounded-lg p-3 text-white font-bold outline-none focus:border-cyan-500 transition"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-slate-300 mb-1">{t("Big Blind")}</label>
                      <input
                        id="createBlindBig"
                        type="number"
                        min={1}
                        defaultValue={100}
                        className="w-full bg-[#11122D] border border-white/10 rounded-lg p-3 text-white font-bold outline-none focus:border-cyan-500 transition"
                      />
                    </div>
                  </div>
                </div>
                <button 
                  onClick={async () => {
                     const maxVal = parseInt((document.getElementById("createTableMax") as HTMLSelectElement)?.value || "8");
                     const modeVal = (document.getElementById("createTableMode") as HTMLSelectElement)?.value || "ai-bot";
                     const blindSmallInput = parseInt((document.getElementById("createBlindSmall") as HTMLInputElement)?.value || "50");
                     const blindBigInput = parseInt((document.getElementById("createBlindBig") as HTMLInputElement)?.value || "100");
                     const roomType: LobbyRoomType = modeVal === "cash" ? "cash" : "ai_bot";
                     const blindSmall = Number.isFinite(blindSmallInput) && blindSmallInput > 0 ? blindSmallInput : 50;
                     const blindBig = Number.isFinite(blindBigInput) && blindBigInput >= blindSmall ? blindBigInput : Math.max(100, blindSmall * 2);

                     try {
                       const created = await apiFetch<{ id: string; type: LobbyRoomType }>("/rooms", {
                         method: "POST",
                         body: JSON.stringify({
                           name: modeVal === "cash" ? "Custom Cash Game" : "Custom Bot Game",
                           type: roomType,
                           maxSeats: maxVal,
                           blindSmall,
                           blindBig,
                         }),
                       });

                       setShowCreateModal(false);
                       void loadTables();
                       navigateToRoom(created.id, {
                         mode: created.type === "ai_bot" ? "bot" : created.type,
                         allowStartControl: true,
                       });
                     } catch (error) {
                       alert(error instanceof Error ? error.message : t("Failed to create table."));
                     }
                  }}
                  className="mt-6 w-full font-black py-4 rounded-xl text-white uppercase tracking-wider transition-all active:translate-y-1 shadow-lg bg-gradient-to-b from-yellow-400 to-orange-500 shadow-[0_4px_0_#B45309]"
                >
                  {t("Create Table")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PASSWORD MODAL */}
      <AnimatePresence>
        {passwordModalTable !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-[#242754] w-full max-w-sm rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
            >
              <div className="bg-[#1A1C3E] p-4 flex justify-between items-center border-b border-white/5">
                <h3 className="text-xl font-black uppercase tracking-wider flex items-center gap-2">
                  <Lock className="text-red-400 w-6 h-6"/> {t("Private Table")}
                </h3>
                <button onClick={() => { setPasswordModalTable(null); setJoinCode(""); }} className="text-slate-400 hover:text-white transition">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="p-6">
                <div className="flex flex-col gap-4">
                  <p className="text-sm font-semibold text-slate-300">{t("This table is protected. Please enter the password set by the host to join.")}</p>
                  <input
                    type="text"
                    placeholder={t("Enter Room Code")}
                    autoFocus
                    value={joinCode}
                    onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                    className="w-full bg-[#11122D] border border-white/10 rounded-lg p-4 text-white font-bold outline-none focus:border-cyan-500 transition placeholder:text-slate-500 text-center text-lg tracking-widest"
                  />
                </div>
                <button 
                  onClick={async () => {
                    try {
                      const room = await apiFetch<{ id: string; type: LobbyRoomType }>(
                        "/rooms/join/code",
                        {
                          method: "POST",
                          body: JSON.stringify({ code: joinCode.trim().toUpperCase() }),
                        },
                      );

                      setPasswordModalTable(null);
                      setJoinCode("");
                      navigateToRoom(room.id, {
                        mode: room.type === "ai_bot" ? "bot" : room.type,
                        allowStartControl: false,
                      });
                    } catch (error) {
                      alert(error instanceof Error ? error.message : t("Failed to enter table."));
                    }
                  }}
                  className="mt-6 w-full font-black py-4 rounded-xl text-white uppercase tracking-wider transition-all active:translate-y-1 shadow-lg bg-gradient-to-b from-cyan-500 to-blue-600 shadow-[0_4px_0_#1D4ED8]"
                >
                  {t("Enter Table")}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SPECTATE TOURNAMENT MODAL */}
      <AnimatePresence>
        {spectateTournamentModal !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-[#242754] w-full max-w-2xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="bg-[#1A1C3E] p-4 md:p-5 flex justify-between items-center border-b border-white/5 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="bg-purple-500/20 p-2 rounded-lg">
                    <Trophy className="text-purple-400 w-6 h-6"/>
                  </div>
                  <div>
                    <h3 className="text-xl font-black uppercase tracking-wider text-white">{t("Spectate Tournament")}</h3>
                    <p className="text-sm text-cyan-400 font-bold">{spectateTournamentModal.name}</p>
                  </div>
                </div>
                <button onClick={() => setSpectateTournamentModal(null)} className="text-slate-400 hover:text-white transition p-2 bg-white/5 rounded-lg">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-4 md:p-6 overflow-y-auto flex-1 custom-scrollbar">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Mock Tables inside Tournament */}
                  {[
                    { id: "t-1", name: "Table 1 (Featured)", players: 6, max: 6, avgStack: "142K" },
                    { id: "t-2", name: "Table 2", players: 6, max: 6, avgStack: "98K" },
                    { id: "t-3", name: "Table 3", players: 5, max: 6, avgStack: "115K" },
                    { id: "t-4", name: "Table 4", players: 6, max: 6, avgStack: "104K" },
                    { id: "t-5", name: "Table 5", players: 4, max: 6, avgStack: "88K" },
                    { id: "t-6", name: "Table 6", players: 6, max: 6, avgStack: "155K" },
                  ].map((tbl) => (
                    <motion.div 
                      key={tbl.id}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => {
                        if (!spectateTournamentModal?.id) return;
                        navigateToRoom(spectateTournamentModal.id, {
                          mode: "tournament",
                          spectate: true,
                          tournamentTable: tbl.id,
                          allowStartControl: false,
                        });
                      }}
                      className="bg-[#11122D] border border-white/10 hover:border-purple-500/50 p-4 rounded-xl cursor-pointer group transition-all relative overflow-hidden"
                    >
                      <div className="absolute inset-0 bg-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                      <div className="flex justify-between items-start mb-3 relative z-10">
                        <div>
                          <h4 className="font-bold text-white text-lg flex items-center gap-2">
                            {tbl.name}
                            {tbl.id === "t-1" && <span className="bg-red-500 text-[10px] px-2 py-0.5 rounded uppercase tracking-widest">{t("Live")}</span>}
                          </h4>
                          <span className="text-xs text-slate-400 font-semibold">{t("Avg Stack")}: {tbl.avgStack}</span>
                        </div>
                        <div className="bg-black/50 px-2 py-1 rounded text-xs font-mono font-bold text-slate-300 flex items-center gap-1 border border-white/5">
                          <Users className="w-3 h-3" />
                          {tbl.players}/{tbl.max}
                        </div>
                      </div>
                      <div className="w-full flex justify-between items-center relative z-10 mt-2 border-t border-white/5 pt-3">
                        <span className="text-xs font-bold text-purple-400 uppercase tracking-wider group-hover:text-purple-300 transition-colors">{t("Watch Live")}</span>
                        <ChevronRight className="w-4 h-4 text-purple-500 group-hover:translate-x-1 transition-transform" />
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PROFILE MODAL */}
      <AnimatePresence>
        {showProfileModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-[#242754] w-full max-w-sm rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
            >
              <div className="bg-[#1A1C3E] p-4 flex justify-between items-center border-b border-white/5">
                <h3 className="text-xl font-black uppercase tracking-wider flex items-center gap-2">
                  <Users className="text-cyan-400 w-6 h-6"/> {t("Player Profile")}
                </h3>
                <button onClick={() => setShowProfileModal(false)} className="text-slate-400 hover:text-white transition">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="p-4 md:p-6 flex flex-col items-center">
                 <div className="w-24 h-24 rounded-full bg-slate-800 border-4 border-cyan-500 overflow-hidden mb-4 shadow-[0_0_15px_rgba(6,182,212,0.5)]">
                   <img src={avatarPreviewUrl} alt="avatar" />
                 </div>
                 <h2 className="text-2xl font-black">{isLoggedIn ? (profileMe?.nickname ?? userName) : "Guest_1092"}</h2>
                 <p className="text-cyan-400 font-bold text-sm mb-6 uppercase tracking-widest">{isLoggedIn ? ((profileMe?.role ?? (isPro ? "pro" : "free")) === "pro" ? t("PRO Member") : t("FREE User")) : t("Guest")}</p>

                 {profileError && isLoggedIn && (
                   <div className="w-full mb-4 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm font-semibold text-red-300">
                     {profileError}
                   </div>
                 )}

                 {profileLoading && isLoggedIn && (
                   <div className="w-full mb-4 rounded-lg border border-white/10 bg-[#11122D] px-3 py-3 text-sm font-semibold text-slate-300">
                     {t("Loading profile...")}
                   </div>
                 )}
                 
                 {isLoggedIn && (
                   <div className="flex gap-2 w-full mb-6">
                     <button onClick={() => setProfileTab("stats")} className={`flex-1 py-2 text-xs font-bold uppercase rounded-lg transition ${profileTab === "stats" ? "bg-cyan-600 text-white" : "bg-[#11122D] text-slate-400 hover:text-white"}`}>{t("Stats")}</button>
                     <button onClick={() => setProfileTab("avatar")} className={`flex-1 py-2 text-xs font-bold uppercase rounded-lg transition ${profileTab === "avatar" ? "bg-cyan-600 text-white" : "bg-[#11122D] text-slate-400 hover:text-white"}`}>{t("Avatar")}</button>
                     <button onClick={() => setProfileTab("settings")} className={`flex-1 py-2 text-xs font-bold uppercase rounded-lg transition ${profileTab === "settings" ? "bg-cyan-600 text-white" : "bg-[#11122D] text-slate-400 hover:text-white"}`}>{t("Settings")}</button>
                   </div>
                 )}

                 {(!isLoggedIn || profileTab === "stats") && (
                   <div className="w-full bg-[#11122D] rounded-xl p-4 border border-white/5 grid grid-cols-2 gap-4 text-center mb-2">
                      <div>
                        <div className="text-slate-400 text-xs font-bold uppercase mb-1">{t("Win Rate")}</div>
                        <div className="text-green-400 font-black text-xl">{profileStats ? `${profileStats.winRate.toFixed(1)}%` : "-"}</div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-xs font-bold uppercase mb-1">{t("Hands Played")}</div>
                        <div className="text-white font-black text-xl">{profileStats ? profileStats.playedHands.toLocaleString() : "-"}</div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-xs font-bold uppercase mb-1">{t("Biggest Pot")}</div>
                        <div className="text-yellow-400 font-black text-xl">{profileStats ? `$${profileStats.biggestPot.toLocaleString()}` : "-"}</div>
                      </div>
                      <div>
                        <div className="text-slate-400 text-xs font-bold uppercase mb-1">{t("Wins")}</div>
                        <div className="text-white font-black text-xl">{profileStats ? profileStats.winHands.toLocaleString() : "-"}</div>
                      </div>
                   </div>
                 )}

                 {isLoggedIn && profileTab === "avatar" && (
                   <div className="w-full flex flex-col gap-4 max-h-[360px] overflow-y-auto pr-2 custom-scrollbar">
                     <div className="flex flex-col gap-2">
                       <label className="text-[10px] font-bold text-slate-400 uppercase">{t("Hair / Hat")}</label>
                       <div className="grid grid-cols-2 gap-2">
                         {AVATAR_TOP_OPTIONS.map((option) => (
                           <button
                             key={option.value}
                             type="button"
                             onClick={() => setAvatarOptions((prev) => ({ ...prev, top: option.value }))}
                             className={`rounded-lg border px-2 py-2 text-xs font-bold transition ${avatarOptions.top === option.value ? "border-cyan-400 bg-cyan-500/20 text-cyan-200" : "border-white/10 bg-[#11122D] text-slate-300 hover:border-cyan-500/40"}`}
                           >
                             {option.label}
                           </button>
                         ))}
                       </div>
                     </div>

                     <div className="flex flex-col gap-2">
                       <label className="text-[10px] font-bold text-slate-400 uppercase">{t("Skin Color")}</label>
                       <div className="flex flex-wrap gap-2">
                         {AVATAR_SKIN_COLORS.map((color) => (
                           <button
                             key={color}
                             type="button"
                             onClick={() => setAvatarOptions((prev) => ({ ...prev, skinColor: color }))}
                             className={`h-7 w-7 rounded-full border-2 transition ${avatarOptions.skinColor === color ? "border-cyan-300 scale-110" : "border-white/25 hover:border-cyan-500/60"}`}
                             style={{ backgroundColor: `#${color}` }}
                             aria-label={`skin-${color}`}
                           />
                         ))}
                       </div>
                     </div>

                     <div className="flex flex-col gap-2">
                       <label className="text-[10px] font-bold text-slate-400 uppercase">{t("Hair Color")}</label>
                       <div className="flex flex-wrap gap-2">
                         {AVATAR_HAIR_COLORS.map((color) => (
                           <button
                             key={color}
                             type="button"
                             onClick={() => setAvatarOptions((prev) => ({ ...prev, hairColor: color }))}
                             className={`h-7 w-7 rounded-full border-2 transition ${avatarOptions.hairColor === color ? "border-cyan-300 scale-110" : "border-white/25 hover:border-cyan-500/60"}`}
                             style={{ backgroundColor: `#${color}` }}
                             aria-label={`hair-${color}`}
                           />
                         ))}
                       </div>
                     </div>

                     <div className="flex flex-col gap-2">
                       <label className="text-[10px] font-bold text-slate-400 uppercase">{t("Clothing")}</label>
                       <div className="grid grid-cols-2 gap-2">
                         {AVATAR_OUTFIT_OPTIONS.map((option) => (
                           <button
                             key={option.value}
                             type="button"
                             onClick={() => setAvatarOptions((prev) => ({ ...prev, clothing: option.value }))}
                             className={`rounded-lg border px-2 py-2 text-xs font-bold transition ${avatarOptions.clothing === option.value ? "border-cyan-400 bg-cyan-500/20 text-cyan-200" : "border-white/10 bg-[#11122D] text-slate-300 hover:border-cyan-500/40"}`}
                           >
                             {option.label}
                           </button>
                         ))}
                       </div>
                     </div>

                     <div className="grid grid-cols-2 gap-3">
                       <div className="flex flex-col gap-2">
                         <label className="text-[10px] font-bold text-slate-400 uppercase">{t("Eyes")}</label>
                         <div className="flex flex-col gap-2">
                           {AVATAR_EYE_OPTIONS.map((option) => (
                             <button
                               key={option.value}
                               type="button"
                               onClick={() => setAvatarOptions((prev) => ({ ...prev, eyes: option.value }))}
                               className={`rounded-lg border px-2 py-2 text-xs font-bold transition ${avatarOptions.eyes === option.value ? "border-cyan-400 bg-cyan-500/20 text-cyan-200" : "border-white/10 bg-[#11122D] text-slate-300 hover:border-cyan-500/40"}`}
                             >
                               {option.label}
                             </button>
                           ))}
                         </div>
                       </div>
                       <div className="flex flex-col gap-2">
                         <label className="text-[10px] font-bold text-slate-400 uppercase">{t("Mouth")}</label>
                         <div className="flex flex-col gap-2">
                           {AVATAR_MOUTH_OPTIONS.map((option) => (
                             <button
                               key={option.value}
                               type="button"
                               onClick={() => setAvatarOptions((prev) => ({ ...prev, mouth: option.value }))}
                               className={`rounded-lg border px-2 py-2 text-xs font-bold transition ${avatarOptions.mouth === option.value ? "border-cyan-400 bg-cyan-500/20 text-cyan-200" : "border-white/10 bg-[#11122D] text-slate-300 hover:border-cyan-500/40"}`}
                             >
                               {option.label}
                             </button>
                           ))}
                         </div>
                       </div>
                     </div>

                     <div className="flex flex-col gap-2">
                       <label className="text-[10px] font-bold text-slate-400 uppercase">{t("Eyebrows")}</label>
                       <div className="grid grid-cols-2 gap-2">
                         {AVATAR_FACE_OPTIONS.map((option) => (
                           <button
                             key={option.value}
                             type="button"
                             onClick={() => setAvatarOptions((prev) => ({ ...prev, face: option.value }))}
                             className={`rounded-lg border px-2 py-2 text-xs font-bold transition ${avatarOptions.face === option.value ? "border-cyan-400 bg-cyan-500/20 text-cyan-200" : "border-white/10 bg-[#11122D] text-slate-300 hover:border-cyan-500/40"}`}
                           >
                             {option.label}
                           </button>
                         ))}
                       </div>
                     </div>

                     <button onClick={() => { void saveAvatar(); }} disabled={profileBusy} className="bg-cyan-600 hover:bg-cyan-500 text-white font-black py-3 rounded-lg transition shadow-md w-full mt-1 disabled:opacity-50">
                       {t("Save Avatar")}
                     </button>
                   </div>
                 )}

                 {isLoggedIn && profileTab === "settings" && (
                   <div className="w-full flex flex-col gap-4">
                     <div className="flex flex-col gap-2">
                       <label className="text-xs font-bold text-slate-400 uppercase">{t("Change Password")}</label>
                       <input
                         type="password"
                         placeholder={t("Current Password")}
                         value={passwordForm.currentPassword}
                         onChange={(event) => setPasswordForm((prev) => ({ ...prev, currentPassword: event.target.value }))}
                         className="w-full bg-[#11122D] border border-white/10 rounded-lg p-3 text-white font-bold outline-none focus:border-cyan-500 transition placeholder:text-slate-600"
                       />
                       <input
                         type="password"
                         placeholder={t("New Password")}
                         value={passwordForm.newPassword}
                         onChange={(event) => setPasswordForm((prev) => ({ ...prev, newPassword: event.target.value }))}
                         className="w-full bg-[#11122D] border border-white/10 rounded-lg p-3 text-white font-bold outline-none focus:border-cyan-500 transition placeholder:text-slate-600"
                       />
                       <input
                         type="password"
                         placeholder={t("Confirm New Password")}
                         value={passwordForm.confirmPassword}
                         onChange={(event) => setPasswordForm((prev) => ({ ...prev, confirmPassword: event.target.value }))}
                         className="w-full bg-[#11122D] border border-white/10 rounded-lg p-3 text-white font-bold outline-none focus:border-cyan-500 transition placeholder:text-slate-600"
                       />
                       <button onClick={() => { void updatePassword(); }} disabled={profileBusy} className="bg-cyan-600 hover:bg-cyan-500 text-white font-black py-3 rounded-lg transition shadow-md w-full mt-2 disabled:opacity-50">
                         {t("Update Password")}
                       </button>
                     </div>
                   </div>
                 )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SETTINGS MODAL */}
      <AnimatePresence>
        {showSettingsModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-[#242754] w-full max-w-sm rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
            >
              <div className="bg-[#1A1C3E] p-4 flex justify-between items-center border-b border-white/5">
                <h3 className="text-xl font-black uppercase tracking-wider flex items-center gap-2">
                  <Settings className="text-slate-300 w-6 h-6"/> {t("Settings")}
                </h3>
                <button onClick={() => setShowSettingsModal(false)} className="text-slate-400 hover:text-white transition">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="p-6 flex flex-col gap-6">
                 
                 {/* Language */}
                 <div>
                   <h4 className="text-sm font-bold text-slate-300 flex items-center gap-2 mb-3 uppercase tracking-wider">
                     <Globe className="w-4 h-4"/> {t("Language")}
                   </h4>
                   <select
                     value={settingsLanguage}
                     onChange={(event) => setSettingsLanguage(event.target.value as PreferredLanguage)}
                     disabled={!isLoggedIn || settingsBusy}
                     className="w-full bg-[#11122D] border border-white/10 rounded-lg p-3 text-white font-bold outline-none focus:border-cyan-500 transition disabled:opacity-60"
                   >
                      <option value="en">English</option>
                      <option value="ko">한국어 (Korean)</option>
                      <option value="ja">日本語 (Japanese)</option>
                   </select>
                 </div>

                 {/* Volume */}
                 <div>
                   <h4 className="text-sm font-bold text-slate-300 flex items-center gap-2 mb-3 uppercase tracking-wider">
                     <Volume2 className="w-4 h-4"/> {t("Audio Settings")}
                   </h4>
                   <div className="flex flex-col gap-4 bg-[#11122D] p-4 rounded-xl border border-white/5">
                     <div className="flex items-center gap-4">
                       <span className="text-xs font-bold text-slate-400 w-16">BGM</span>
                       <input
                         type="range"
                         min="0"
                         max="100"
                         value={audioSettings.bgm}
                         onChange={(event) => {
                           const next = Number.parseInt(event.target.value, 10);
                           const merged = { ...audioSettings, bgm: Number.isFinite(next) ? next : 0 };
                           setAudioSettingsState(merged);
                           setAudioSettings({ bgm: merged.bgm });
                         }}
                         className="flex-1 accent-cyan-500"
                       />
                       <span className="text-xs font-bold text-cyan-300 w-10 text-right">{audioSettings.bgm}</span>
                     </div>
                     <div className="flex items-center gap-4">
                       <span className="text-xs font-bold text-slate-400 w-16">CARD</span>
                       <input
                         type="range"
                         min="0"
                         max="100"
                         value={audioSettings.card}
                         onChange={(event) => {
                           const next = Number.parseInt(event.target.value, 10);
                           const merged = { ...audioSettings, card: Number.isFinite(next) ? next : 0 };
                           setAudioSettingsState(merged);
                           setAudioSettings({ card: merged.card });
                         }}
                         className="flex-1 accent-cyan-500"
                       />
                       <span className="text-xs font-bold text-cyan-300 w-10 text-right">{audioSettings.card}</span>
                     </div>
                     <div className="flex items-center gap-4">
                       <span className="text-xs font-bold text-slate-400 w-16">VICTORY</span>
                       <input
                         type="range"
                         min="0"
                         max="100"
                         value={audioSettings.victory}
                         onChange={(event) => {
                           const next = Number.parseInt(event.target.value, 10);
                           const merged = {
                             ...audioSettings,
                             victory: Number.isFinite(next) ? next : 0,
                           };
                           setAudioSettingsState(merged);
                           setAudioSettings({ victory: merged.victory });
                         }}
                         className="flex-1 accent-cyan-500"
                       />
                       <span className="text-xs font-bold text-cyan-300 w-10 text-right">{audioSettings.victory}</span>
                     </div>
                   </div>
                 </div>

                 <button
                   onClick={() => {
                     void saveSettings();
                   }}
                   disabled={settingsBusy}
                   className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white font-black py-3 rounded-xl mt-2"
                 >
                   {settingsBusy ? t("Saving...") : t("Save Changes")}
                 </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SOCIAL MODAL */}
      <AnimatePresence>
        {showSocialModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-[#242754] w-full max-w-2xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
            >
              <div className="bg-[#1A1C3E] p-4 flex justify-between items-center border-b border-white/5">
                <h3 className="text-xl font-black uppercase tracking-wider flex items-center gap-2">
                  <UserPlus className="text-cyan-400 w-6 h-6" /> {t("Friends & Invites")}
                </h3>
                <button onClick={() => setShowSocialModal(false)} className="text-slate-400 hover:text-white transition">
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="p-5 md:p-6 flex flex-col gap-5 max-h-[80vh] overflow-y-auto">
                {socialNotice ? (
                  <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm font-semibold text-cyan-200">
                    {socialNotice}
                  </div>
                ) : null}

                <div className="bg-[#11122D] border border-white/10 rounded-xl p-4">
                  <h4 className="text-sm font-black text-white uppercase tracking-wider mb-3">{t("Find Players")}</h4>
                  <div className="flex gap-2">
                    <input
                      value={friendSearch}
                      onChange={(event) => setFriendSearch(event.target.value)}
                      placeholder={t("Enter nickname")}
                      className="flex-1 bg-[#0A0B1F] border border-white/10 rounded-lg p-3 text-white font-bold outline-none focus:border-cyan-500 transition placeholder:text-slate-500"
                    />
                    <button
                      onClick={() => {
                        void handleSearchUsers();
                      }}
                      disabled={socialBusy}
                      className="px-4 py-3 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white font-black text-sm uppercase"
                    >
                      {t("Search")}
                    </button>
                  </div>
                  <div className="mt-3 flex flex-col gap-2">
                    {friendSearchResults.map((user) => (
                      <div key={user.id} className="bg-[#0A0B1F] border border-white/10 rounded-lg px-3 py-2 flex items-center justify-between">
                        <div className="flex flex-col">
                          <span className="font-bold text-white">{user.nickname}</span>
                          <span className="text-[11px] uppercase tracking-wider text-slate-400">{user.role}</span>
                        </div>
                        <button
                          onClick={() => {
                            void handleSendFriendRequest(user.nickname);
                          }}
                          disabled={socialBusy || user.isFriend}
                          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-black uppercase"
                        >
                          {user.isFriend ? t("Friend") : t("Add")}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-[#11122D] border border-white/10 rounded-xl p-4">
                    <h4 className="text-sm font-black text-white uppercase tracking-wider mb-3">{t("Incoming Requests")}</h4>
                    <div className="flex flex-col gap-2">
                      {incomingFriendRequests.length === 0 ? (
                        <p className="text-sm text-slate-400 font-semibold">{t("No incoming requests.")}</p>
                      ) : (
                        incomingFriendRequests.map((request) => (
                          <div key={request.id} className="bg-[#0A0B1F] border border-white/10 rounded-lg px-3 py-2 flex items-center justify-between gap-2">
                            <span className="font-bold text-white text-sm">{request.requesterNickname}</span>
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  void handleRespondFriendRequest(request.id, true);
                                }}
                                className="px-2 py-1 rounded bg-green-600 hover:bg-green-500 text-white text-[11px] font-black uppercase"
                              >
                                {t("Accept")}
                              </button>
                              <button
                                onClick={() => {
                                  void handleRespondFriendRequest(request.id, false);
                                }}
                                className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-white text-[11px] font-black uppercase"
                              >
                                {t("Decline")}
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="bg-[#11122D] border border-white/10 rounded-xl p-4">
                    <h4 className="text-sm font-black text-white uppercase tracking-wider mb-3">{t("Friends")}</h4>
                    <div className="flex flex-col gap-2 max-h-[220px] overflow-y-auto">
                      {friends.length === 0 ? (
                        <p className="text-sm text-slate-400 font-semibold">{t("No friends added yet.")}</p>
                      ) : (
                        friends.map((friend) => (
                          <div key={friend.id} className="bg-[#0A0B1F] border border-white/10 rounded-lg px-3 py-2 flex items-center justify-between">
                            <span className="font-bold text-white text-sm">{friend.nickname}</span>
                            <span className="text-[11px] uppercase tracking-wider text-slate-400">{friend.role}</span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-[#11122D] border border-white/10 rounded-xl p-4">
                  <h4 className="text-sm font-black text-white uppercase tracking-wider mb-3">{t("Room Invites")}</h4>
                  <div className="flex flex-col gap-2">
                    {roomInvites.length === 0 ? (
                      <p className="text-sm text-slate-400 font-semibold">{t("No pending room invites.")}</p>
                    ) : (
                      roomInvites.map((invite) => (
                        <div key={invite.id} className="bg-[#0A0B1F] border border-white/10 rounded-lg px-3 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                          <div className="flex flex-col">
                            <span className="font-bold text-white text-sm">{invite.roomName}</span>
                            <span className="text-[11px] text-slate-400">{invite.inviterNickname} {t("invited you")}</span>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                void handleRespondRoomInvite(invite.id, true);
                              }}
                              className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-black uppercase"
                            >
                              {t("Accept")}
                            </button>
                            <button
                              onClick={() => {
                                void handleRespondRoomInvite(invite.id, false);
                              }}
                              className="px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-white text-xs font-black uppercase"
                            >
                              {t("Decline")}
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {outgoingFriendRequests.length > 0 ? (
                  <div className="bg-[#11122D] border border-white/10 rounded-xl p-4">
                    <h4 className="text-sm font-black text-white uppercase tracking-wider mb-3">{t("Sent Requests")}</h4>
                    <div className="flex flex-wrap gap-2">
                      {outgoingFriendRequests.map((request) => (
                        <span key={request.id} className="px-2.5 py-1 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-200 text-xs font-bold">
                          {request.targetNickname}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HELP & SUPPORT MODAL */}
      <AnimatePresence>
        {showHelpSupportModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-[#242754] w-full max-w-sm rounded-2xl border border-white/10 shadow-2xl overflow-hidden"
            >
              <div className="bg-[#1A1C3E] p-4 flex justify-between items-center border-b border-white/5">
                <h3 className="text-xl font-black uppercase tracking-wider flex items-center gap-2">
                  <Info className="text-cyan-400 w-6 h-6"/> {t("Help & Support")}
                </h3>
                <button onClick={() => setShowHelpSupportModal(false)} className="text-slate-400 hover:text-white transition">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="p-6 flex flex-col gap-4">
                <div className="bg-[#11122D] border border-white/10 rounded-xl p-4">
                  <h4 className="text-sm font-bold text-cyan-300 uppercase tracking-wider mb-2">{t("Basic Guide")}</h4>
                  <ul className="text-sm text-slate-300 space-y-2 font-semibold">
                    <li>1. {t("Use Quick Play for instant matchmaking.")}</li>
                    <li>2. {t("Use Hand Review to analyze recent hands.")}</li>
                    <li>3. {t("Use Store to purchase chips or PRO.")}</li>
                  </ul>
                </div>

                <div className="bg-[#11122D] border border-white/10 rounded-xl p-4">
                  <h4 className="text-sm font-bold text-cyan-300 uppercase tracking-wider mb-2">{t("Developer Info")}</h4>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-12 w-12 rounded-lg overflow-hidden border border-white/10 bg-white/5">
                      <img
                        src="/main2.png"
                        alt="Dvely logo"
                        className="h-full w-full object-cover object-center"
                      />
                    </div>
                    <p className="text-sm text-slate-300 font-semibold">{t("Team")}: Dvely</p>
                  </div>
                  <a
                    href="https://github.com/Dvely"
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-cyan-300 hover:text-cyan-200 underline break-all font-bold"
                  >
                    {t("GitHub Profile")}: github.com/Dvely
                  </a>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SLIDE OUT MENU */}
      <AnimatePresence>
        {showMenu && (
          <>
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }}
              onClick={() => setShowMenu(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" 
            />
            <motion.div 
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 w-64 md:w-80 bg-[#1A1C3E] border-r border-white/10 shadow-2xl z-50 flex flex-col"
            >
               <div className="p-6 border-b border-white/5 flex justify-between items-center bg-[#11122D]">
                 <h2 className="text-2xl font-black italic">AIPOT</h2>
                 <button onClick={() => setShowMenu(false)} className="text-slate-400 hover:text-white"><X className="w-6 h-6" /></button>
               </div>

               <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
                 <button onClick={() => { setShowProfileModal(true); setShowMenu(false); }} className="flex items-center gap-3 w-full p-3 rounded-lg hover:bg-white/5 text-slate-300 hover:text-white font-bold transition text-left">
                   <Users className="w-5 h-5" /> {t("Profile")}
                 </button>
                 <button onClick={() => { navigate("/store"); setShowMenu(false); }} className="flex items-center gap-3 w-full p-3 rounded-lg hover:bg-white/5 text-slate-300 hover:text-white font-bold transition text-left">
                   <ShoppingBag className="w-5 h-5 text-yellow-400" /> {t("Store")}
                 </button>
                 <button
                   onClick={() => {
                     if (!isLoggedIn) {
                       alert(t("Sign in to use social features."));
                       return;
                     }
                     setShowSocialModal(true);
                     setShowMenu(false);
                   }}
                   className="flex items-center gap-3 w-full p-3 rounded-lg hover:bg-white/5 text-slate-300 hover:text-white font-bold transition text-left"
                 >
                   <UserPlus className="w-5 h-5" /> {t("Friends")}
                 </button>
                 <button onClick={() => { setShowSettingsModal(true); setShowMenu(false); }} className="flex items-center gap-3 w-full p-3 rounded-lg hover:bg-white/5 text-slate-300 hover:text-white font-bold transition text-left">
                   <Settings className="w-5 h-5" /> {t("Settings")}
                 </button>
                 <button onClick={() => { setShowHelpSupportModal(true); setShowMenu(false); }} className="flex items-center gap-3 w-full p-3 rounded-lg hover:bg-white/5 text-slate-300 hover:text-white font-bold transition text-left">
                   <Info className="w-5 h-5" /> {t("Help & Support")}
                 </button>
               </div>

               <div className="p-4 border-t border-white/5">
                 <button 
                   onClick={() => {
                     signOut();
                     navigate("/");
                   }}
                   className="flex items-center gap-3 w-full p-3 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 font-bold transition text-left"
                 >
                   <LogOut className="w-5 h-5" /> {isLoggedIn ? t("Log Out") : t("Exit to Login")}
                 </button>
               </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

    </div>
  );
}
