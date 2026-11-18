export type Session = {
  serverUrl: string;
  accessToken: string;
  refreshToken?: string;
  profileId?: string;
  profileToken?: string;
  profileAvatar?: string;
  profileMetadataLoaded?: boolean;
  userId: string;
  username: string;
  /** A phone profile's borrowed sign-in (#156): memory only, refreshed in its own lane. */
  temporary?: TemporaryLane;
};

/**
 * The tokens of a borrowed sign-in, shared by every copy of its Session. It never reaches the
 * server registry or storage; `onRefused` ends it when the server refuses a refresh.
 */
export type TemporaryLane = {
  accessToken: string;
  refreshToken: string;
  ended: boolean;
  onRefused(): void;
};

export type SiloItem = {
  Id: string;
  Name: string;
  Type?: string;
  SeriesName?: string;
  SeriesId?: string;
  SeasonName?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  ProductionYear?: number;
  DateAdded?: string;
  ReleaseDate?: string;
  AirDate?: string;
  SeasonCount?: number;
  EpisodeCount?: number;
  Resolution?: string;
  Author?: string;
  Narrator?: string;
  Publisher?: string;
  AudiobookDurationSeconds?: number;
  AudiobookAuthorNames?: string;
  AudiobookNarratorNames?: string;
  Overview?: string;
  /** The viewer's language the overview is still missing; a translation can be asked for (metadata AI). */
  PendingTranslationLanguage?: string;
  /** Fields the server machine-translated, such as "overview". */
  MachineTranslatedFields?: string[];
  Genres?: string[];
  ContentRating?: string;
  ImdbRating?: number;
  TmdbRating?: number;
  RuntimeMinutes?: number;
  RunTimeTicks?: number;
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
  PosterUrl?: string;
  BackdropUrl?: string;
  /** Smaller backdrop for wide rail cards (the hero keeps BackdropUrl). */
  CardBackdropUrl?: string;
  PosterThumbhash?: string;
  BackdropThumbhash?: string;
  PosterIsEpisodeStill?: boolean;
  BackdropIsEpisodeStill?: boolean;
  LogoUrl?: string;
  /** A card for a collection on a row of collections (#170), not a title. */
  CollectionCard?: { source: "library" | "user"; libraryId?: number; itemCount: number };
  /** The profile's own rating, 1 to 10 (#180); undefined when unrated. */
  UserRating?: number;
  /** Marked Not interested (#179); undefined where the server doesn't say. */
  NotInterested?: boolean;
  /** A card for a movie box set (#171), not a title. */
  BoxSet?: { id: string; libraryId: string; movieCount: number; playedCount: number };
  UserData?: {
    Played?: boolean;
    PlaybackPositionTicks?: number;
    PlayedPercentage?: number;
    IsFavorite?: boolean;
    InWatchlist?: boolean;
  };
};

export type ItemsResponse = {
  Items: SiloItem[];
  TotalRecordCount?: number;
};

export type HomeRail = {
  id: string;
  title: string;
  featured?: boolean;
  /** Server section id; with `libraryId` it addresses the row's full page. */
  sectionId?: string;
  /** Owning library for library rows; null for Home rows. */
  libraryId?: number | null;
  items: SiloItem[];
};

export type SiloCalendarItem = {
  contentId: string;
  type: string;
  title: string;
  episodeTitle?: string;
  seriesId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  airDate: string;
  airTime?: string;
  localAirDate: string;
  posterUrl?: string;
  posterThumbhash?: string;
  watched: boolean;
  badges: string[];
};

export type SiloCalendarDay = {
  date: string;
  items: SiloCalendarItem[];
};

export type SiloRequestResult = {
  mediaType: string;
  tmdbId: number;
  title: string;
  year?: number;
  overview: string;
  posterPath?: string;
  backdropPath?: string;
  availability: string;
  libraryContentId?: string;
  requestable: boolean;
  reason: string;
  requestId?: string;
  following: boolean;
};

export type SiloMediaRequest = {
  id: string;
  mediaType: string;
  tmdbId: number;
  title: string;
  year?: number;
  status: string;
  outcome: string;
  state?: string;
  createdAt: string;
  /** Failed and delivered nothing: the requester may remove it (#172). */
  removable?: boolean;
};

/** A movie box set (#171, silo-server #2784): a TMDB collection's movies in one library, in release order. */
export type SiloBoxSet = {
  id: string;
  libraryId: string;
  title: string;
  overview?: string;
  posterUrl?: string;
  posterThumbhash?: string;
  backdropUrl?: string;
  movieCount: number;
  playedCount: number;
  firstYear?: number;
  lastYear?: number;
  items: SiloItem[];
};

export type SiloLibrary = {
  id: number;
  name: string;
  type: string;
};

export type SiloProfile = {
  id: string;
  name: string;
  avatarEmoji?: string;
  avatarUrl?: string;
  hasPin: boolean;
  isPrimary: boolean;
};

export type SiloCollection = {
  id: string;
  name: string;
  itemCount?: number;
  posterUrl?: string;
  posterThumbhash?: string;
  kind: "regular" | "user_collection";
  groupName?: string;
};

export type ServerEntry = {
  id: string;
  name: string;
  url: string;
  lastUsedAt: number;
  session?: Session;
};
