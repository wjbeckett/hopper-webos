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
  Overview?: string;
  RunTimeTicks?: number;
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
  PosterUrl?: string;
  BackdropUrl?: string;
  UserData?: {
    Played?: boolean;
    PlaybackPositionTicks?: number;
    PlayedPercentage?: number;
    IsFavorite?: boolean;
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
