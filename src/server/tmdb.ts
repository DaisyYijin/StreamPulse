const API = 'https://api.themoviedb.org/3';

const MOVIE_GENRES: Record<number, string> = {
  28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
  27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance',
  878: 'Science Fiction', 10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western',
};
const TV_GENRES: Record<number, string> = {
  10759: 'Action & Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
  99: 'Documentary', 18: 'Drama', 10751: 'Family', 10762: 'Kids', 9648: 'Mystery',
  10763: 'News', 10764: 'Reality', 10765: 'Sci-Fi & Fantasy', 10766: 'Soap',
  10767: 'Talk', 10768: 'War & Politics', 37: 'Western',
};

export interface TmdbInfo {
  id: number;
  mediaType: 'movie' | 'tv';
  title: string;
  year: string;
  genres: string[];
  countries: string[];
  languages: string[];
  overview: string;
}

export class TmdbError extends Error {
  constructor(message: string, readonly status = 502) { super(message); this.name = 'TmdbError'; }
}

async function request(path: string, params: Record<string, string>, key: string): Promise<any> {
  if (!key.trim()) throw new TmdbError('请先在整理设置中填写 TMDb API Key', 400);
  const query = new URLSearchParams({ api_key: key.trim(), ...params });
  const response = await fetch(`${API}${path}?${query}`, {
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) {
    throw new TmdbError(payload?.status_message || `TMDb 请求失败（HTTP ${response.status}）`, response.status === 401 ? 401 : 502);
  }
  return payload;
}

export async function searchTmdb(options: {
  mediaType: 'movie' | 'tv';
  title: string;
  year: string;
  apiKey: string;
  language: string;
}): Promise<TmdbInfo | null> {
  const params: Record<string, string> = {
    query: options.title,
    language: options.language,
    include_adult: 'false',
  };
  if (options.year) {
    params[options.mediaType === 'movie' ? 'year' : 'first_air_date_year'] = options.year;
  }
  const payload = await request(`/search/${options.mediaType}`, params, options.apiKey);
  const result = (payload?.results ?? [])[0];
  if (!result) return null;
  return details(options.mediaType, result.id, options.apiKey, options.language);
}

async function details(mediaType: 'movie' | 'tv', id: number, apiKey: string, language: string): Promise<TmdbInfo> {
  const payload = await request(`/${mediaType}/${id}`, { language }, apiKey);
  const genres = (payload.genres ?? []).map((genre: { name: string }) => genre.name);
  return {
    id,
    mediaType,
    title: payload.title || payload.name || '',
    year: String(payload.release_date || payload.first_air_date || '').slice(0, 4),
    genres: genres.length ? genres : (payload.genre_ids ?? []).map((genre: number) => (mediaType === 'movie' ? MOVIE_GENRES : TV_GENRES)[genre]).filter(Boolean),
    countries: payload.origin_country ?? payload.production_countries?.map((item: { iso_3166_1: string }) => item.iso_3166_1) ?? [],
    languages: [payload.original_language].filter(Boolean),
    overview: payload.overview || '',
  };
}
