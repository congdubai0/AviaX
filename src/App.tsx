import { useEffect, useState, type ReactNode } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { adminRequest, apiRequest, ApiError } from "./api";
import { id } from "./i18n/id";

type Screen = "missions" | "flight" | "leaderboard" | "friends";
type MissionStatus = "not_started" | "checking" | "done";
type MissionType = "JOIN_CHANNEL" | "VISIT_LINK" | "DEMO_TIMER" | "SOFT_CHECK";
type Mission = {
  id: string;
  key: string;
  title: string;
  points: number;
  type: MissionType;
  status: MissionStatus;
  locked: boolean;
};
type Bootstrap = {
  user: {
    firstName: string;
    username: string | null;
    points: number;
    ageConfirmed: boolean;
    referralUrl: string;
  };
  prizeText: string | null;
  period: { startsAt: string | null; endsAt: string | null; secondsRemaining: number; timezone: string; configured?: boolean };
};
type FlightStatus = {
  today: { completed: boolean; points: number | null };
  streak: number;
  streakTarget: number;
  streakBonusPoints: number;
  days: Array<{ date: string; completed: boolean }>;
  nextFlightAt: string;
  secondsUntilNext: number;
};
type FlightAward = {
  awarded: boolean;
  points: number;
  bonusPoints: number;
  flight: FlightStatus;
};
type LeaderboardResponse = {
  entries: Array<{ rank: number; displayName: string; points: number }>;
  me: { rank: number | null; points: number };
  period: { startsAt: string | null; endsAt: string | null; secondsRemaining: number; configured?: boolean };
  prizeText?: string | null;
};
type ReferralsPage = {
  referralUrl: string;
  joinedToday: number;
  dailyLimit: number;
  totalFriends: number;
  nextOffset: number | null;
  friends: Array<{ displayName: string; status: "joined" | "qualified"; joinedAt: string }>;
};
type CheckinAward = {
  awarded: boolean;
  points: number;
  bonusPoints: number;
  status: "done";
};
type MissionStart = {
  status: MissionStatus;
  channelUrl?: string;
  redirectUrl?: string;
  pageUrl?: string;
  minimumSeconds?: number;
};
type MissionVerification = {
  status: MissionStatus;
  retry?: boolean;
  retryAfterSeconds?: number;
  message?: string;
};
type AdminMetrics = {
  totals: { users: number; points: number; clicks: number };
  flaggedUsers: Array<{
    telegramId: number;
    username: string | null;
    firstName: string;
    isFlagged: boolean;
    isBanned: boolean;
    createdAt: string;
  }>;
  dailyDraws: Array<{
    date: string;
    points: number;
    telegramId: number | null;
    username: string | null;
    firstName: string | null;
  }>;
  weeks: Array<{
    weekNumber: number;
    isFinal: boolean;
    entries: Array<{ rank: number; displayName: string; points: number }>;
  }>;
  rewardConfiguration: {
    weekly?: { top_1?: number; top_2?: number; top_3?: number };
    daily_draw?: { per_day_usd?: number };
    final_week?: { top_1?: number; top_2?: number; top_3?: number };
    total_usd?: number;
    TODO?: string;
  };
  timezone: string;
};

const queryKeys = {
  bootstrap: ["bootstrap"],
  missions: ["missions"],
  flight: ["flight"],
  leaderboard: ["leaderboard"],
  referrals: ["referrals"],
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("id-ID").format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short" }).format(new Date(value));
}

function formatCountdown(totalSeconds: number) {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const clock = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return days > 0 ? `${days}H ${clock}` : clock;
}

function useCountdown(initialValue: number | undefined) {
  const [remaining, setRemaining] = useState(initialValue ?? 0);
  useEffect(() => {
    setRemaining(initialValue ?? 0);
  }, [initialValue]);
  useEffect(() => {
    if (remaining <= 0) return undefined;
    const interval = window.setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(interval);
  }, [remaining > 0]);
  return remaining;
}

function openExternal(url: string) {
  if (window.Telegram?.WebApp?.openLink) {
    window.Telegram.WebApp.openLink(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function Icon({
  name,
  size = 20,
}: {
  name: "plane" | "missions" | "flight" | "leaderboard" | "friends" | "gift" | "check" | "arrow" | "lock" | "copy" | "share" | "refresh" | "clock" | "link" | "channel" | "timer" | "close" | "user" | "star";
  size?: number;
}) {
  const props = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (name) {
    case "plane":
      return <svg {...props}><path d="m21 3-7.2 18-3.4-7.4L3 10.2 21 3Z" /><path d="m10.4 13.6 5-5" /></svg>;
    case "missions":
      return <svg {...props}><path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="m19 16 .9 2.1L22 19l-2.1.9L19 22l-.9-2.1L16 19l2.1-.9L19 16Z" /></svg>;
    case "flight":
      return <svg {...props}><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></svg>;
    case "leaderboard":
      return <svg {...props}><path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4Z" /><path d="M7 6H4v2a4 4 0 0 0 4 4M17 6h3v2a4 4 0 0 1-4 4" /></svg>;
    case "friends":
      return <svg {...props}><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></svg>;
    case "gift":
      return <svg {...props}><rect x="3" y="8" width="18" height="13" rx="2" /><path d="M12 8v13M3 12h18M12 8H7.5a2.5 2.5 0 1 1 2.4-3.2L12 8Zm0 0h4.5a2.5 2.5 0 1 0-2.4-3.2L12 8Z" /></svg>;
    case "check":
      return <svg {...props}><path d="m5 12 4 4L19 6" /></svg>;
    case "arrow":
      return <svg {...props}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
    case "lock":
      return <svg {...props}><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>;
    case "copy":
      return <svg {...props}><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></svg>;
    case "share":
      return <svg {...props}><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.7 10.5 6.6-4M8.7 13.5l6.6 4" /></svg>;
    case "refresh":
      return <svg {...props}><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.5 9a7 7 0 0 1 11.6-2.6L20 12M4 12l2.9 5.6A7 7 0 0 0 18.5 15" /></svg>;
    case "clock":
      return <svg {...props}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case "link":
      return <svg {...props}><path d="M10 13a5 5 0 0 0 7.1 0l3-3A5 5 0 0 0 13 2.9l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.1 0l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7" /></svg>;
    case "channel":
      return <svg {...props}><path d="M4 6h16v12H4z" /><path d="m4 7 8 6 8-6" /></svg>;
    case "timer":
      return <svg {...props}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l3 2M9 2h6M19 5l1.5 1.5" /></svg>;
    case "close":
      return <svg {...props}><path d="m18 6-12 12M6 6l12 12" /></svg>;
    case "user":
      return <svg {...props}><circle cx="12" cy="8" r="4" /><path d="M5 21a7 7 0 0 1 14 0" /></svg>;
    case "star":
      return <svg {...props}><path d="m12 3 2.7 5.5 6 .9-4.4 4.3 1 6.1-5.3-2.9-5.3 2.9 1-6.1-4.4-4.3 6-.9L12 3Z" /></svg>;
  }
}

function AppFrame({ children }: { children: ReactNode }) {
  return <main className="aviax-app">{children}</main>;
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <section className="av-panel av-loading" role="status">
      <div className="av-skeleton av-skeleton-short" />
      <div className="av-skeleton av-skeleton-long" />
      <p>{label}</p>
    </section>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <section className="av-panel av-error-panel" role="alert">
      <span className="av-alert-mark">!</span>
      <div><h2>{id.common.unableToLoad}</h2><p>{message}</p></div>
      {onRetry && <button className="av-button av-button-quiet" onClick={onRetry} type="button"><Icon name="refresh" size={16} /> {id.common.retry}</button>}
    </section>
  );
}

function App() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const isAdminPath = location.pathname === "/admin";
  const isTermsPath = location.pathname === "/terms";
  const routeScreen = location.pathname.replace(/^\//, "");
  const screen: Screen = ["missions", "flight", "leaderboard", "friends"].includes(routeScreen)
    ? routeScreen as Screen
    : "missions";
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [notice, setNotice] = useState("");
  const [missionTimers, setMissionTimers] = useState<Record<string, number>>({});
  const [missionBusy, setMissionBusy] = useState<string | null>(null);
  const [missionMessage, setMissionMessage] = useState<Record<string, string>>({});
  const [flightAward, setFlightAward] = useState<FlightAward | null>(null);
  useEffect(() => {
    if (location.pathname === "/") navigate("/missions", { replace: true });
  }, [location.pathname, navigate]);
  const bootstrap = useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: () => apiRequest<Bootstrap>("/api/bootstrap"),
  });
  const ageConfirmed = bootstrap.data?.user.ageConfirmed ?? false;
  const missions = useQuery({
    queryKey: queryKeys.missions,
    queryFn: () => apiRequest<{ missions: Mission[] }>("/api/missions"),
    enabled: ageConfirmed,
  });
  const flight = useQuery({
    queryKey: queryKeys.flight,
    queryFn: () => apiRequest<FlightStatus>("/api/flight"),
    enabled: ageConfirmed,
  });
  const leaderboard = useQuery({
    queryKey: queryKeys.leaderboard,
    queryFn: () => apiRequest<LeaderboardResponse>("/api/leaderboard"),
    enabled: ageConfirmed && screen === "leaderboard",
    refetchInterval: 45_000,
    refetchIntervalInBackground: false,
  });
  const referrals = useInfiniteQuery({
    queryKey: queryKeys.referrals,
    queryFn: ({ pageParam }) => apiRequest<ReferralsPage>(`/api/referrals?offset=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextOffset ?? undefined,
    enabled: ageConfirmed,
  });
  const ageConfirm = useMutation({
    mutationFn: () => apiRequest<{ ageConfirmed: boolean }>("/api/age-confirm", {
      method: "POST",
      body: JSON.stringify({ confirm: true }),
    }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap }),
  });
  const checkinMutation = useMutation({
    mutationFn: () => apiRequest<CheckinAward>("/api/missions/daily_checkin/start", { method: "POST" }),
    onSuccess: async () => {
      await refreshPlayerData();
      await queryClient.invalidateQueries({ queryKey: queryKeys.flight });
    },
  });
  const flightMutation = useMutation({
    mutationFn: () => apiRequest<FlightAward>("/api/flight", { method: "POST" }),
    onSuccess: async (result) => {
      setFlightAward(result);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.flight }),
        queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap }),
        queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard }),
        queryClient.invalidateQueries({ queryKey: queryKeys.missions }),
      ]);
    },
  });

  const periodSeconds = useCountdown(bootstrap.data?.period.secondsRemaining);
  const flightSeconds = useCountdown(flight.data?.secondsUntilNext);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setMissionTimers((current) => {
        let changed = false;
        const next = { ...current };
        for (const [key, seconds] of Object.entries(current)) {
          if (seconds > 0) {
            next[key] = seconds - 1;
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const telegram = window.Telegram?.WebApp;
    telegram?.ready();
    telegram?.expand();
  }, []);

  useEffect(() => {
    if (notice === "") return undefined;
    const timer = window.setTimeout(() => setNotice(""), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (isTermsPath) return <TermsPage />;
  if (isAdminPath) return <AdminPage />;
  if (bootstrap.isPending) return <AppFrame><LoadingPanel label={id.common.loadingAccount} /></AppFrame>;
  if (bootstrap.isError) {
    const message = bootstrap.error instanceof ApiError && bootstrap.error.status === 401
      ? id.common.noTelegramSession
      : bootstrap.error.message;
    return (
      <AppFrame>
        <div className="av-welcome-cloud">
          <Brand />
          <div className="av-logo-large"><Icon name="plane" size={44} /></div>
          <p className="av-eyebrow">{id.welcome.eyebrow}</p>
          <h1>{id.welcome.titleStart}<br /><span>{id.welcome.titleEnd}</span></h1>
          <p className="av-welcome-copy">{id.welcome.intro}</p>
          <div className="av-age-note"><strong>18+</strong><span>{id.welcome.ageNotice}</span></div>
          <ErrorPanel message={message} onRetry={() => bootstrap.refetch()} />
        </div>
      </AppFrame>
    );
  }

  if (!ageConfirmed) {
    return (
      <AppFrame>
        <div className="av-welcome-cloud">
          <Brand />
          <div className="av-logo-large"><Icon name="plane" size={44} /></div>
          <p className="av-eyebrow">{id.welcome.eyebrow}</p>
          <h1>{id.welcome.titleStart}<br /><span>{id.welcome.titleEnd}</span></h1>
          <p className="av-welcome-copy">{id.welcome.introConsent}</p>
          {bootstrap.data.prizeText && <div className="av-prize-callout"><Icon name="gift" size={19} /><span>{id.leaderboard.currentPrize}</span><strong>{bootstrap.data.prizeText}</strong></div>}
          <div className="av-age-note"><strong>18+</strong><span>{id.welcome.ageNotice}</span></div>
          <ul className="av-rule-list">
            <li>{id.welcome.ruleAccount}</li>
            <li>{id.welcome.ruleVerification}</li>
            <li>{id.welcome.ruleFree}</li>
          </ul>
          <label className="av-terms-check">
            <input checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} type="checkbox" />
            <span>{id.welcome.ageAndTerms} <a href="#/terms">{id.welcome.termsLink}</a>.</span>
          </label>
          {ageConfirm.isError && <p className="av-inline-error" role="alert">{ageConfirm.error.message}</p>}
          <button className="av-button av-button-primary av-button-wide" disabled={!termsAccepted || ageConfirm.isPending} onClick={() => ageConfirm.mutate()} type="button">
            {ageConfirm.isPending ? id.welcome.saving : id.welcome.start}
            {!ageConfirm.isPending && <Icon name="arrow" size={18} />}
          </button>
        </div>
      </AppFrame>
    );
  }

  const tabs: Array<{ id: Screen; label: string; icon: Parameters<typeof Icon>[0]["name"] }> = [
    { id: "missions", label: id.navigation.missions, icon: "missions" },
    { id: "flight", label: id.navigation.flight, icon: "flight" },
    { id: "leaderboard", label: id.navigation.leaderboard, icon: "leaderboard" },
    { id: "friends", label: id.navigation.friends, icon: "friends" },
  ];

  async function refreshPlayerData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.missions }),
      queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap }),
      queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard }),
      queryClient.invalidateQueries({ queryKey: queryKeys.flight }),
    ]);
  }

  async function handleMission(mission: Mission) {
    if (mission.locked || mission.status === "done" || missionBusy) return;
    setMissionBusy(mission.key);
    setMissionMessage((current) => ({ ...current, [mission.key]: "" }));
    try {
      if (mission.key === "daily_checkin") {
        const result = await checkinMutation.mutateAsync();
        setMissionMessage((current) => ({
          ...current,
          [mission.key]: result.awarded
            ? id.mission.checkinSuccess(formatNumber(result.points + result.bonusPoints))
            : id.mission.checkinAlreadyDone,
        }));
        return;
      }
      if (mission.status === "not_started") {
        const started = await apiRequest<MissionStart>(`/api/missions/${encodeURIComponent(mission.key)}/start`, {
          method: "POST",
        });
        await queryClient.invalidateQueries({ queryKey: queryKeys.missions });
        if (started.status === "done") {
          await refreshPlayerData();
          return;
        }
        if (started.minimumSeconds) {
          setMissionTimers((current) => ({ ...current, [mission.key]: started.minimumSeconds ?? 0 }));
        }
        if (mission.type === "VISIT_LINK" && started.redirectUrl) {
          openExternal(started.redirectUrl);
          setMissionMessage((current) => ({ ...current, [mission.key]: id.mission.visitOpened }));
        } else if (mission.type === "JOIN_CHANNEL" && started.channelUrl) {
          if (window.Telegram?.WebApp?.openTelegramLink) {
            window.Telegram.WebApp.openTelegramLink(started.channelUrl);
          } else {
            openExternal(started.channelUrl);
          }
          setMissionMessage((current) => ({ ...current, [mission.key]: id.mission.channelOpened }));
        } else if (mission.type === "SOFT_CHECK") {
          if (started.pageUrl) openExternal(started.pageUrl);
          setMissionMessage((current) => ({ ...current, [mission.key]: id.mission.socialOpened }));
        } else if (mission.type === "DEMO_TIMER") {
          if (started.pageUrl) openExternal(started.pageUrl);
          setMissionMessage((current) => ({ ...current, [mission.key]: id.mission.demoStarted }));
        }
        return;
      }

      const result = await apiRequest<MissionVerification>(`/api/missions/${encodeURIComponent(mission.key)}/verify`, {
        method: "POST",
      });
      if (result.status === "done") {
        setMissionTimers((current) => ({ ...current, [mission.key]: 0 }));
        setMissionMessage((current) => ({ ...current, [mission.key]: id.mission.complete(formatNumber(mission.points)) }));
        await refreshPlayerData();
      } else if (result.retryAfterSeconds) {
        setMissionTimers((current) => ({ ...current, [mission.key]: result.retryAfterSeconds ?? 0 }));
        setMissionMessage((current) => ({ ...current, [mission.key]: id.mission.tooEarly }));
      } else if (result.retry) {
        setMissionMessage((current) => ({ ...current, [mission.key]: result.message ?? id.mission.retry }));
        await queryClient.invalidateQueries({ queryKey: queryKeys.missions });
      } else {
        await refreshPlayerData();
      }
    } catch (error) {
      setMissionMessage((current) => ({ ...current, [mission.key]: error instanceof Error ? error.message : id.mission.failure }));
    } finally {
      setMissionBusy(null);
    }
  }

  const activePage = {
    missions: <MissionsPage
      firstName={bootstrap.data.user.firstName}
      missions={missions.data?.missions}
      loading={missions.isPending}
      error={missions.error}
      onRetry={() => missions.refetch()}
      prizeText={null}
      periodEndsAt={bootstrap.data.period.endsAt}
      periodSeconds={periodSeconds}
      timers={missionTimers}
      messages={missionMessage}
      busyKey={missionBusy}
      onMission={handleMission}
      onFlight={() => navigate("/flight")}
    />,
    flight: <FlightPage
      flight={flight.data}
      loading={flight.isPending}
      error={flight.error}
      onRetry={() => flight.refetch()}
      secondsUntilNext={flightSeconds}
      award={flightAward}
      onFly={() => { setFlightAward(null); flightMutation.mutate(); }}
      isPending={flightMutation.isPending}
      mutationError={flightMutation.error}
    />,
    leaderboard: <LeaderboardPage
      leaderboard={leaderboard.data}
      loading={leaderboard.isPending}
      error={leaderboard.error}
      onRetry={() => leaderboard.refetch()}
      prizeText={leaderboard.data?.prizeText ?? null}
      periodSeconds={leaderboard.data?.period.secondsRemaining ?? periodSeconds}
      periodEndsAt={leaderboard.data?.period.endsAt ?? bootstrap.data.period.endsAt}
    />,
    friends: <FriendsPage
      referrals={referrals.data?.pages ?? []}
      loading={referrals.isPending}
      error={referrals.error}
      onRetry={() => referrals.refetch()}
      onLoadMore={() => referrals.fetchNextPage()}
      hasMore={referrals.hasNextPage}
      loadingMore={referrals.isFetchingNextPage}
      setNotice={setNotice}
    />,
  }[screen];

  return (
    <AppFrame>
      <header className="av-topbar">
        <Brand />
        <div className="av-topbar-user">
          <div className="av-user-greeting"><span>{id.common.greeting(bootstrap.data.user.firstName)}</span><strong>{id.common.readyToFly}</strong></div>
          <div className="av-points-chip"><Icon name="star" size={16} /><span>{formatNumber(bootstrap.data.user.points)}</span><small>{id.mission.points}</small></div>
        </div>
      </header>

      <div className="av-main-content">{activePage}</div>

      <nav aria-label={id.navigation.label} className="av-bottom-nav">
        {tabs.map((tab) => (
          <button
            aria-current={screen === tab.id ? "page" : undefined}
            className={screen === tab.id ? "av-nav-item is-active" : "av-nav-item"}
            key={tab.id}
            onClick={() => navigate(`/${tab.id}`)}
            type="button"
          >
            <Icon name={tab.icon} size={19} />
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      {notice && <div className="av-toast" role="status">{notice}</div>}
    </AppFrame>
  );
}

function TermsPage() {
  return (
    <AppFrame>
      <section className="av-card av-terms-page">
        <a className="av-admin-back" href="#/missions">← {id.terms.back}</a>
        <p className="av-eyebrow">{id.common.appName}</p>
        <h1>{id.terms.title}</h1>
        <p>{id.terms.age}</p>
        <p>{id.terms.free}</p>
        <p>{id.terms.verification}</p>
        <p>{id.terms.fraud}</p>
        <p>{id.terms.prizes}</p>
        <p>{id.terms.privacy}</p>
        <p className="av-terms-todo">{id.terms.todo}</p>
      </section>
    </AppFrame>
  );
}

function Brand() {
  return (
    <a aria-label={id.common.brandLabel} className="av-brand" href="#/missions">
      <span className="av-brand-icon"><Icon name="plane" size={22} /></span>
      <span><strong>Avia<span>X</span></strong><small>{id.common.brandTagline}</small></span>
    </a>
  );
}

function MissionsPage({
  firstName,
  missions,
  loading,
  error,
  onRetry,
  prizeText,
  periodEndsAt,
  periodSeconds,
  timers,
  messages,
  busyKey,
  onMission,
  onFlight,
}: {
  firstName: string;
  missions?: Mission[];
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  prizeText: string | null;
  periodEndsAt: string | null;
  periodSeconds: number;
  timers: Record<string, number>;
  messages: Record<string, string>;
  busyKey: string | null;
  onMission: (mission: Mission) => void;
  onFlight: () => void;
}) {
  const completed = missions?.filter((mission) => mission.status === "done").length ?? 0;
  const missionTotal = missions?.length ?? 0;
  return (
    <div className="av-page-stack">
      <section className="av-hero-card">
        <div className="av-hero-content">
          <div className="av-hero-eyebrow"><span className="av-status-dot" /> {id.home.eyebrow}</div>
          <h1>{id.common.greeting(firstName)}.<br /><span>{id.home.titleEnd}</span></h1>
          <p>{id.home.description}</p>
          <div className="av-hero-period">
            <span><Icon name="clock" size={15} /> {periodEndsAt ? id.common.periodEnds(formatDate(periodEndsAt)) : id.leaderboard.noPeriod}</span>
            <strong>{formatCountdown(periodSeconds)}</strong>
          </div>
        </div>
        <div aria-hidden="true" className="av-plane-scene">
          <div className="av-cloud av-cloud-one" />
          <div className="av-cloud av-cloud-two" />
          <span className="av-flight-trail" />
          <div className="av-plane-badge"><Icon name="plane" size={57} /></div>
          <span className="av-plane-spark av-plane-spark-one">✦</span>
          <span className="av-plane-spark av-plane-spark-two">✧</span>
        </div>
        <div className="av-progress-card">
          <div className="av-progress-caption"><span>{id.home.progress}</span><strong>{completed}/{missionTotal}</strong></div>
          <div aria-label={id.common.missionCompletion(completed, missionTotal)} className="av-progress-track">
            <span style={{ width: `${missionTotal ? (completed / missionTotal) * 100 : 0}%` }} />
          </div>
          <span className="av-progress-note">{completed === missionTotal && missionTotal > 0 ? id.home.allDone : id.home.progressHint}</span>
        </div>
      </section>

      {prizeText && (
        <div className="av-prize-strip">
          <span className="av-prize-icon"><Icon name="gift" size={18} /></span>
          <span><small>{id.home.weeklyPrize}</small><strong>{prizeText}</strong></span>
          <span className="av-prize-arrow" aria-hidden="true">✦</span>
        </div>
      )}

      <section className="av-section">
        <div className="av-section-heading">
          <div><p className="av-eyebrow">{id.home.collectPoints}</p><h2>{id.home.missionsTitle}</h2></div>
          <span className="av-section-count">{completed}/{missionTotal} {id.home.finished}</span>
        </div>
        {loading && <LoadingPanel label={id.common.loadingMissions} />}
        {error && <ErrorPanel message={error.message} onRetry={onRetry} />}
        {missions?.map((mission, index) => (
          <MissionCard
            key={mission.id}
            index={index + 1}
            mission={mission}
            remaining={timers[mission.key] ?? 0}
            message={messages[mission.key] ?? ""}
            busy={busyKey === mission.key}
            onAction={() => onMission(mission)}
          />
        ))}
        {missions && missions.length === 0 && <div className="av-empty-panel">{id.home.noMissions}</div>}
      </section>

      <button className="av-flight-promo" onClick={onFlight} type="button">
        <span className="av-flight-promo-icon"><Icon name="plane" size={23} /></span>
        <span><small>{id.home.ready}</small><strong>{id.home.flightPromo}</strong></span>
        <Icon name="arrow" size={19} />
      </button>
      <p className="av-legal-note">{id.home.legalNote}</p>
    </div>
  );
}

function MissionCard({
  mission,
  index,
  remaining,
  message,
  busy,
  onAction,
}: {
  mission: Mission;
  index: number;
  remaining: number;
  message: string;
  busy: boolean;
  onAction: () => void;
}) {
  const isDone = mission.status === "done";
  const isLocked = mission.locked;
  const actionLabel = busy
    ? id.missionStatus.processing
    : isDone
      ? id.missionStatus.done
      : isLocked
        ? id.missionStatus.locked
        : remaining > 0
          ? formatCountdown(remaining)
          : mission.status === "checking"
            ? id.missionStatus.verifying
            : id.missionStatus.notStarted;
  const icon = mission.type === "JOIN_CHANNEL"
    ? "channel"
    : mission.type === "VISIT_LINK"
      ? "link"
      : mission.type === "DEMO_TIMER"
        ? "timer"
        : "friends";
  const detail = isLocked
    ? id.mission.locked
    : mission.type === "JOIN_CHANNEL"
      ? id.mission.joinChannel
      : mission.type === "VISIT_LINK"
        ? id.mission.visitAviax
        : mission.type === "DEMO_TIMER"
          ? id.mission.demoTimer
          : id.mission.softCheck;
  return (
    <article className={`av-mission-card${isDone ? " is-done" : ""}${isLocked ? " is-locked" : ""}`}>
      <div className="av-mission-symbol"><Icon name={icon} size={19} /></div>
      <div className="av-mission-copy">
        <div className="av-mission-title-line"><h3>{mission.title}</h3>{isLocked && <Icon name="lock" size={14} />}</div>
        <p>{detail}</p>
        {message && <span className="av-mission-message" role="status">{message}</span>}
      </div>
      <div className="av-mission-reward"><strong>+{formatNumber(mission.points)}</strong><small>{id.mission.points}</small></div>
      <button
        aria-label={`${actionLabel}: ${mission.title}`}
        className={`av-mission-action${isDone ? " is-done" : ""}${isLocked ? " is-locked" : ""}`}
        disabled={isDone || isLocked || busy || remaining > 0}
        onClick={onAction}
        type="button"
      >
        {isDone ? <Icon name="check" size={17} /> : isLocked ? <Icon name="lock" size={15} /> : null}
        <span>{actionLabel}</span>
      </button>
      <span className="av-mission-index">{String(index).padStart(2, "0")}</span>
    </article>
  );
}

function FlightPage({
  flight,
  loading,
  error,
  onRetry,
  secondsUntilNext,
  award,
  onFly,
  isPending,
  mutationError,
}: {
  flight?: FlightStatus;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  secondsUntilNext: number;
  award: FlightAward | null;
  onFly: () => void;
  isPending: boolean;
  mutationError: Error | null;
}) {
  const days = flight?.days ?? [];
  return (
    <div className="av-page-stack">
      <section className="av-flight-hero">
        <p className="av-eyebrow">{id.flight.eyebrow}</p>
        <h1>{id.flight.heading}<br /><span>{id.flight.title}</span></h1>
        <p className="av-flight-intro">{id.flight.intro}</p>
        <div className="av-flight-cloud-scene" aria-hidden="true">
          <div className="av-flight-cloud av-flight-cloud-a" />
          <div className="av-flight-cloud av-flight-cloud-b" />
          <div className="av-flight-cloud av-flight-cloud-c" />
          <span className="av-flight-route" />
          <div className="av-flight-plane"><Icon name="plane" size={50} /></div>
        </div>
        <div className="av-streak-pill"><Icon name="flight" size={15} /> {id.common.flightStreak(flight?.streak ?? 0)}</div>
      </section>

      {loading && <LoadingPanel label={id.flight.loading} />}
      {error && <ErrorPanel message={error.message} onRetry={onRetry} />}

      {flight && (
        <>
          <section className="av-card av-today-flight">
            <div className="av-today-heading">
              <div><p className="av-eyebrow">{id.flight.today}</p><h2>{flight.today.completed ? id.flight.alreadyFlown : id.flight.ready}</h2></div>
              <div className={`av-today-mark${flight.today.completed ? " is-completed" : ""}`}><Icon name={flight.today.completed ? "check" : "plane"} size={21} /></div>
            </div>
            <div className="av-flight-award">
              <span className="av-award-spark">✦</span>
              <strong>{flight.today.completed ? `+${formatNumber(flight.today.points ?? 0)}` : "?"}</strong>
              <small>{flight.today.completed ? id.flight.pointsReceived : id.flight.randomPoints}</small>
              {flight.today.completed && <span className="av-award-note">{id.flight.pointsAdded}</span>}
            </div>
            {!flight.today.completed ? (
              <button className="av-button av-button-primary av-button-wide av-fly-button" disabled={isPending} onClick={onFly} type="button">
                <Icon name="plane" size={18} /> {isPending ? id.flight.flying : id.flight.flyNow}
              </button>
            ) : (
              <div className="av-next-flight"><Icon name="clock" size={16} /><span>{id.flight.nextFlight}</span><strong>{formatCountdown(secondsUntilNext)}</strong></div>
            )}
            {award?.awarded && <p className="av-flight-success" role="status">{id.flight.flightSuccess(formatNumber(award.points), award.bonusPoints > 0 ? formatNumber(award.bonusPoints) : "")}</p>}
            {mutationError && <p className="av-inline-error" role="alert">{mutationError.message}</p>}
          </section>

          <section className="av-card av-streak-card">
            <div className="av-section-heading">
              <div><p className="av-eyebrow">{id.flight.keepFlying}</p><h2>{id.flight.weeklyStreak}</h2></div>
              <span className="av-streak-bonus">+{formatNumber(flight.streakBonusPoints)} {id.flight.bonus}</span>
            </div>
            <div className="av-streak-days">
              {days.map((day) => (
                <div className="av-streak-day" key={day.date}>
                  <span className={day.completed ? "av-streak-dot is-complete" : "av-streak-dot"}>{day.completed ? <Icon name="check" size={14} /> : "·"}</span>
                  <small>{new Intl.DateTimeFormat("id-ID", { weekday: "short" }).format(new Date(`${day.date}T00:00:00`))}</small>
                  <span className="av-streak-date">{new Date(`${day.date}T00:00:00`).getDate()}</span>
                </div>
              ))}
            </div>
            <p className="av-streak-copy">{id.flight.streakDescription(flight.streakTarget)}</p>
          </section>
        </>
      )}
    </div>
  );
}

function LeaderboardPage({
  leaderboard,
  loading,
  error,
  onRetry,
  prizeText,
  periodSeconds,
  periodEndsAt,
}: {
  leaderboard?: LeaderboardResponse;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  prizeText: string | null;
  periodSeconds: number;
  periodEndsAt: string | null;
}) {
  const leaders = leaderboard?.entries ?? [];
  const podium = [leaders[1], leaders[0], leaders[2]];
  return (
    <div className="av-page-stack">
      <section className="av-rank-hero">
        <div className="av-rank-heading">
          <div><p className="av-eyebrow">{id.leaderboard.eyebrow}</p><h1>{id.leaderboard.heading}<br /><span>{id.leaderboard.title}</span></h1></div>
          <div className="av-rank-clock"><Icon name="clock" size={15} /><span>{formatCountdown(periodSeconds)}</span></div>
        </div>
        <p className="av-rank-date">{periodEndsAt ? id.leaderboard.reset(formatDate(periodEndsAt)) : id.leaderboard.noPeriod} · {id.leaderboard.masked}</p>
        <div className="av-podium" aria-label={id.leaderboard.topTen}>
          {podium.map((entry, index) => (
            <div className={`av-podium-place av-podium-place-${index + 1}`} key={entry?.rank ?? `empty-${index}`}>
              <div className={`av-podium-avatar av-podium-avatar-${index + 1}`}><Icon name={index === 0 ? "star" : "user"} size={index === 1 ? 25 : 20} /></div>
              <strong className="av-podium-name">{entry?.displayName ?? "—"}</strong>
              <span className="av-podium-points">{entry ? `${formatNumber(entry.points)} ${id.common.pointsLabel}` : id.leaderboard.noEntry}</span>
              <span className="av-podium-base">{entry ? `#${entry.rank}` : "—"}</span>
            </div>
          ))}
        </div>
        <div className="av-podium-spark av-podium-spark-one">✦</div>
        <div className="av-podium-spark av-podium-spark-two">✧</div>
      </section>

      {prizeText && (
        <div className="av-prize-strip">
          <span className="av-prize-icon"><Icon name="gift" size={18} /></span>
          <span><small>{id.leaderboard.currentPrize}</small><strong>{prizeText}</strong></span>
          <span className="av-prize-arrow" aria-hidden="true">✦</span>
        </div>
      )}
      {loading && <LoadingPanel label={id.common.loadingLeaderboard} />}
      {error && <ErrorPanel message={error.message} onRetry={onRetry} />}
      {leaderboard && (
        <>
          <section className="av-card av-ranking-card">
            <div className="av-section-heading"><div><p className="av-eyebrow">{id.leaderboard.topPlayers}</p><h2>{id.leaderboard.chase}</h2></div><span className="av-section-count">{id.leaderboard.topTen}</span></div>
            <div className="av-ranking-list">
              {leaders.length > 0 ? leaders.map((entry) => (
                <div className={`av-ranking-row${entry.rank <= 3 ? " is-top-three" : ""}`} key={entry.rank}>
                  <span className={`av-rank-number av-rank-${entry.rank}`}>{entry.rank <= 3 ? ["①", "②", "③"][entry.rank - 1] : String(entry.rank).padStart(2, "0")}</span>
                  <span className="av-ranking-avatar"><Icon name="user" size={17} /></span>
                  <strong>{entry.displayName}</strong>
                  <span className="av-ranking-score"><Icon name="star" size={13} /> {formatNumber(entry.points)}</span>
                </div>
              )) : <div className="av-ranking-empty">{id.leaderboard.empty}</div>}
            </div>
          </section>
          <section className="av-my-rank-card">
            <span className="av-my-rank-icon"><Icon name="user" size={18} /></span>
            <span><small>{id.leaderboard.yourPosition}</small><strong>{leaderboard.me.rank ? id.common.rankNumber(leaderboard.me.rank) : id.leaderboard.notRanked}</strong></span>
            <b><Icon name="star" size={14} /> {formatNumber(leaderboard.me.points)}</b>
          </section>
        </>
      )}
    </div>
  );
}

function FriendsPage({
  referrals,
  loading,
  error,
  onRetry,
  onLoadMore,
  hasMore,
  loadingMore,
  setNotice,
}: {
  referrals: ReferralsPage[];
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  onLoadMore: () => void;
  hasMore: boolean | undefined;
  loadingMore: boolean;
  setNotice: (notice: string) => void;
}) {
  const latest = referrals[referrals.length - 1];
  const friends = referrals.flatMap((page) => page.friends);

  async function copyInvite() {
    if (!latest?.referralUrl) return;
    try {
      await navigator.clipboard.writeText(latest.referralUrl);
      setNotice(id.common.copySuccess);
    } catch {
      setNotice(id.common.copyFailure);
    }
  }

  function shareInvite() {
    if (!latest?.referralUrl) return;
    const url = `https://t.me/share/url?url=${encodeURIComponent(latest.referralUrl)}&text=${encodeURIComponent(id.common.shareMessage)}`;
    openExternal(url);
  }

  return (
    <div className="av-page-stack">
      <section className="av-invite-hero">
        <div className="av-invite-hero-copy">
          <p className="av-eyebrow">{id.common.inviteHeroEyebrow}</p>
          <h1>{id.common.inviteHeroTitle}<br /><span>{id.common.inviteHeroSubtitle}</span></h1>
          <p>{id.common.inviteHeroDescription}</p>
        </div>
        <div className="av-invite-plane" aria-hidden="true"><Icon name="plane" size={43} /></div>
      </section>

      {loading && <LoadingPanel label={id.common.loadingReferrals} />}
      {error && <ErrorPanel message={error.message} onRetry={onRetry} />}

      {latest && (
        <>
          <section className="av-card av-invite-link-card">
            <div className="av-section-heading"><div><p className="av-eyebrow">{id.friends.linkEyebrow}</p><h2>{id.friends.shareLink}</h2></div><span className="av-invite-link-icon"><Icon name="link" size={17} /></span></div>
            <div className="av-link-box"><span>{latest.referralUrl.replace("https://", "")}</span><button aria-label={id.friends.copyLink} onClick={copyInvite} type="button"><Icon name="copy" size={17} /></button></div>
            <button className="av-button av-button-primary av-button-wide av-share-button" onClick={shareInvite} type="button"><Icon name="share" size={18} /> {id.friends.share}</button>
            <p className="av-invite-limit">{id.friends.invitedToday} <strong>{latest.joinedToday}/{latest.dailyLimit}</strong></p>
          </section>

          <div className="av-friend-stats">
            <div className="av-friend-stat"><span className="av-stat-icon"><Icon name="friends" size={18} /></span><span><small>{id.friends.invitedFriends}</small><strong>{formatNumber(latest.totalFriends)}</strong></span></div>
            <div className="av-friend-stat"><span className="av-stat-icon av-stat-icon-gold"><Icon name="star" size={18} /></span><span><small>{id.friends.rewardPerFriend}</small><strong>{id.friends.afterTwoMissions}</strong></span></div>
          </div>

          <section className="av-card av-friends-list-card">
            <div className="av-section-heading"><div><p className="av-eyebrow">{id.friends.crew}</p><h2>{id.friends.joinedFriends}</h2></div><span className="av-section-count">{id.common.friendCount(friends.length)}</span></div>
            {friends.length > 0 ? (
              <div className="av-friends-list">
                {friends.map((friend, index) => (
                  <div className="av-friend-row" key={`${friend.displayName}-${friend.joinedAt}-${index}`}>
                    <span className="av-friend-avatar"><Icon name="user" size={17} /></span>
                    <span className="av-friend-name"><strong>{friend.displayName}</strong><small>{id.common.joinedAt(formatDate(friend.joinedAt))}</small></span>
                    <span className={`av-friend-status${friend.status === "qualified" ? " is-qualified" : ""}`}><span />{friend.status === "qualified" ? id.friends.completed : id.friends.joined}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="av-friends-empty">
                <Icon name="friends" size={25} />
                <strong>{id.friends.emptyTitle}</strong>
                <span>{id.friends.emptyDescription}</span>
              </div>
            )}
            {hasMore && <button className="av-button av-button-quiet av-load-more" disabled={loadingMore} onClick={onLoadMore} type="button">{loadingMore ? id.friends.loadingMore : id.friends.loadMore}</button>}
          </section>
          <p className="av-legal-note">{id.friends.legal}</p>
        </>
      )}
    </div>
  );
}

function AdminPage() {
  const [message, setMessage] = useState("");
  const [telegramId, setTelegramId] = useState("");
  const [campaignStart, setCampaignStart] = useState("");
  const queryClient = useQueryClient();
  const metrics = useQuery({
    queryKey: ["admin-metrics"],
    queryFn: () => adminRequest<AdminMetrics>("/api/admin/metrics", ""),
    retry: false,
  });
  const userMutation = useMutation({
    mutationFn: (values: { flagged: boolean; banned: boolean }) =>
      adminRequest<{ saved: boolean }>(`/api/admin/users/${encodeURIComponent(telegramId)}`, "", {
        method: "PATCH",
        body: JSON.stringify(values),
      }),
    onSuccess: async () => {
      setMessage(id.admin.saved);
      setTelegramId("");
      await queryClient.invalidateQueries({ queryKey: ["admin-metrics"] });
    },
  });
  const drawMutation = useMutation({
    mutationFn: () => adminRequest<{ date: string; winnerId: string | null; alreadyDrawn: boolean }>("/api/admin/metrics", "", {
      method: "POST",
      body: JSON.stringify({ action: "daily_draw" }),
    }),
    onSuccess: async (result) => {
      setMessage(result.winnerId ? id.common.drawFinished(result.date) : id.admin.noEligibleDraw);
      await queryClient.invalidateQueries({ queryKey: ["admin-metrics"] });
    },
  });
  const campaignMutation = useMutation({
    mutationFn: () => adminRequest<{ saved: boolean }>("/api/admin/settings", "", {
      method: "PATCH",
      body: JSON.stringify({ startsAt: new Date(campaignStart).toISOString() }),
    }),
    onSuccess: async () => {
      setMessage(id.admin.scheduleCreated);
      await queryClient.invalidateQueries({ queryKey: ["admin-metrics"] });
    },
  });

  function exportCsv() {
    adminRequest<string>("/api/admin/export.csv", "").then((csv) => {
      const file = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(file);
      const link = document.createElement("a");
      link.href = url;
      link.download = "aviax-winners.csv";
      link.click();
      URL.revokeObjectURL(url);
      setMessage(id.admin.winnersExported);
    }).catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : id.admin.exportFailure);
    });
  }

  return (
    <AppFrame>
      <div className="av-admin-page">
        <header className="av-admin-header"><a href="#/" className="av-admin-back">{id.admin.back}</a><span className="av-eyebrow">{id.admin.dashboard}</span><h1>{id.admin.title}</h1><p>{id.admin.intro}</p></header>
        {metrics.isPending && <LoadingPanel label={id.admin.loading} />}
        {metrics.error && <ErrorPanel message={metrics.error.message} onRetry={() => metrics.refetch()} />}
        {metrics.data && (
          <>
            <div className="av-admin-stats">
              <StatCard label={id.common.player} value={metrics.data.totals.users} />
              <StatCard label={id.common.totalPoints} value={metrics.data.totals.points} />
              <StatCard label={id.common.missionClicks} value={metrics.data.totals.clicks} />
            </div>
            <section className="av-card av-admin-card">
              <p className="av-eyebrow">{id.admin.schedule}</p><h2>{id.admin.fourWeeks}</h2>
              {metrics.data.weeks.length > 0
                ? <p>{id.common.timezone(metrics.data.timezone, metrics.data.weeks.length)}</p>
                : <><p>{id.admin.setStart}</p><label>{id.admin.startsAt}<input onChange={(event) => setCampaignStart(event.target.value)} type="datetime-local" value={campaignStart} /></label><button className="av-button av-button-primary" disabled={!campaignStart || campaignMutation.isPending} onClick={() => campaignMutation.mutate()} type="button">{campaignMutation.isPending ? id.admin.saving : id.admin.createSchedule}</button></>}
              {metrics.data.rewardConfiguration.TODO && <p>{metrics.data.rewardConfiguration.TODO}</p>}
            </section>
            <section className="av-card av-admin-card">
              <p className="av-eyebrow">{id.admin.weeklyResults}</p><h2>{id.admin.topTen}</h2>
              {metrics.data.weeks.length > 0 ? metrics.data.weeks.map((week) => (
                <div className="av-admin-week" key={week.weekNumber}>
                  <strong>{id.common.weekNumber(week.weekNumber, week.isFinal)}</strong>
                  {week.entries.length ? week.entries.map((entry) => <p key={entry.rank}>#{entry.rank} {entry.displayName} · {formatNumber(entry.points)} {id.common.pointsLabel}</p>) : <p>{id.admin.noPlayers}</p>}
                </div>
              )) : <p>{id.admin.noSchedule}</p>}
            </section>
            <section className="av-card av-admin-card">
              <p className="av-eyebrow">{id.admin.moderation}</p><h2>{id.admin.flaggedAccounts}</h2>
              <label>{id.admin.telegramId}<input inputMode="numeric" onChange={(event) => setTelegramId(event.target.value)} value={telegramId} /></label>
              <div className="av-admin-actions">
                <button className="av-button av-button-quiet" disabled={!telegramId || userMutation.isPending} onClick={() => userMutation.mutate({ flagged: true, banned: false })} type="button">{id.admin.mark}</button>
                <button className="av-button av-button-quiet" disabled={!telegramId || userMutation.isPending} onClick={() => userMutation.mutate({ flagged: true, banned: true })} type="button">{id.admin.markAndBan}</button>
                <button className="av-button av-button-primary" disabled={!telegramId || userMutation.isPending} onClick={() => userMutation.mutate({ flagged: false, banned: false })} type="button">{id.admin.restore}</button>
              </div>
              {metrics.data.flaggedUsers.length
                ? metrics.data.flaggedUsers.map((user) => <p key={user.telegramId}>{id.common.idLabel(user.telegramId)} · {user.username ? `@${user.username}` : user.firstName} · {id.common.adminStatus(user.isBanned)}</p>)
                : <p>{id.admin.noFlagged}</p>}
            </section>
            <section className="av-card av-admin-card">
              <p className="av-eyebrow">{id.admin.dailyDraw}</p><h2>{id.admin.participantsToday}</h2>
              <button className="av-button av-button-primary" disabled={drawMutation.isPending} onClick={() => drawMutation.mutate()} type="button">{drawMutation.isPending ? id.admin.drawing : id.admin.drawToday}</button>
              {metrics.data.dailyDraws.slice(0, 10).map((draw) => <p key={draw.date}>{id.common.winnerDate(draw.date)} · {draw.username ? `@${draw.username}` : draw.firstName ?? id.common.noWinner} · {formatNumber(draw.points)}</p>)}
            </section>
            <button className="av-button av-button-quiet av-button-wide" onClick={exportCsv} type="button">{id.admin.exportWinners}</button>
          </>
        )}
        {(message || userMutation.error || drawMutation.error || campaignMutation.error) && <p className={userMutation.error || drawMutation.error || campaignMutation.error ? "av-inline-error" : "av-admin-message"} role="status">{message || userMutation.error?.message || drawMutation.error?.message || campaignMutation.error?.message}</p>}
      </div>
    </AppFrame>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return <div className="av-admin-stat"><small>{label}</small><strong>{formatNumber(value)}</strong></div>;
}

export default App;
