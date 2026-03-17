import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
  ArrayMaxSize,
  IsInt,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

// =============================================================================
// Profile DTOs — Member 4 (Profile & Identity Engineer)
// =============================================================================

// ─── Handle validation regex ──────────────────────────────────────────────────
// Handles must be 3–30 lowercase alphanumeric characters or underscores.
const HANDLE_REGEX = /^[a-z0-9_]{3,30}$/;

// ─── Allowed genre slugs ──────────────────────────────────────────────────────
export const ALLOWED_GENRES = [
  'electronic',
  'hip-hop',
  'pop',
  'rock',
  'alternative',
  'ambient',
  'classical',
  'jazz',
  'r-b-soul',
  'metal',
  'folk-singer-songwriter',
  'country',
  'reggaeton',
  'dancehall',
  'drum-bass',
  'house',
  'techno',
  'deep-house',
  'trance',
  'lo-fi',
  'indie',
  'punk',
  'blues',
  'latin',
  'afrobeat',
  'trap',
  'experimental',
  'world',
  'gospel',
  'spoken-word',
] as const;

export type GenreSlug = (typeof ALLOWED_GENRES)[number];

// ─── Allowed external link platforms ─────────────────────────────────────────
export const ALLOWED_PLATFORMS = [
  'website',
  'twitter',
  'instagram',
  'facebook',
  'youtube',
  'tiktok',
  'spotify',
  'apple-music',
  'bandcamp',
  'soundcloud',
  'patreon',
  'twitch',
  'discord',
  'linkedin',
  'github',
] as const;

export type PlatformSlug = (typeof ALLOWED_PLATFORMS)[number];

// =============================================================================
// UpdateProfileDto
// =============================================================================

export class UpdateProfileDto {
  /**
   * New display name (shown throughout the UI).
   * Does NOT change the user's handle.
   */
  @IsOptional()
  @IsString()
  @Length(2, 50)
  display_name?: string;

  /**
   * Short bio / artist description.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  /**
   * City, country, or region the user wants to show publicly.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  location?: string;

  /**
   * Personal or artist website URL.
   * Must be a valid https URL (SSRF-safe validation done in the service).
   */
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_tld: true, require_protocol: true })
  @MaxLength(255)
  website?: string;

  /**
   * Whether the profile body is hidden from non-followers.
   */
  @IsOptional()
  @IsBoolean()
  is_private?: boolean;

  /**
   * List of genre slugs the user wants to associate with their profile.
   * Maximum 5 genres.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  favorite_genres?: string[];
}

// =============================================================================
// CheckHandleQueryDto
// =============================================================================

export class CheckHandleQueryDto {
  @IsString()
  @IsNotEmpty()
  @Matches(HANDLE_REGEX, {
    message:
      'handle must be 3–30 characters and contain only lowercase letters, numbers, and underscores.',
  })
  handle!: string;
}

// =============================================================================
// ExternalLinkItemDto  (used inside UpdateExternalLinksDto)
// =============================================================================

export class ExternalLinkItemDto {
  /**
   * Platform slug identifying the social network or service.
   */
  @IsString()
  @IsEnum(ALLOWED_PLATFORMS, {
    message: `platform must be one of: ${ALLOWED_PLATFORMS.join(', ')}`,
  })
  platform!: PlatformSlug;

  /**
   * Full HTTPS URL for the link.
   */
  @IsUrl({ protocols: ['https'], require_tld: true, require_protocol: true })
  @MaxLength(2048)
  url!: string;

  /**
   * 0-based sort position for rendering the links list.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  sort_order?: number;
}

// =============================================================================
// UpdateExternalLinksDto
// =============================================================================

/**
 * Full-replace semantics — the client sends the complete desired list of links.
 * The service deletes all existing links and inserts the new set.
 * Maximum 10 links per user.
 */
export class UpdateExternalLinksDto {
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ExternalLinkItemDto)
  links!: ExternalLinkItemDto[];
}

// =============================================================================
// UploadImageParamsDto
// =============================================================================

export class UploadImageParamsDto {
  @IsString()
  @IsEnum(['avatar', 'cover'], {
    message: 'type must be either "avatar" or "cover".',
  })
  type!: 'avatar' | 'cover';
}

// =============================================================================
// GetProfileParamsDto
// =============================================================================

export class GetProfileParamsDto {
  @IsString()
  @IsNotEmpty()
  @Matches(HANDLE_REGEX, {
    message: 'handle must be a valid profile handle.',
  })
  handle!: string;
}
