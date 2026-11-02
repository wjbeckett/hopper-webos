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
  PosterIsEpisodeStill?: boolean;
  BackdropIsEpisodeStill?: boolean;
  LogoUrl?: string;
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
