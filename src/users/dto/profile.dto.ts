import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
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
import { AccountType } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// =============================================================================
// Profile DTOs
// =============================================================================

const HANDLE_REGEX = /^[a-z0-9_]{3,30}$/;

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

// Partial update - fields absent from the body are left unchanged.
export class UpdateProfileDto {
  /**
   * New display name (shown throughout the UI).
   * Does NOT change the user's handle.
   */
  @ApiPropertyOptional({ example: 'Yahia Dev', maxLength: 50, minLength: 2, description: 'Display name shown throughout the UI. Does not change the handle.' })
  @IsOptional()
  @IsString()
  @Length(2, 50)
  display_name?: string;

  @ApiPropertyOptional({ example: 'Music producer from Cairo.', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @ApiPropertyOptional({ example: 'Cairo, Egypt', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  location?: string;

  // SSRF validation is deferred to the service; IsUrl alone is not SSRF-safe.
  // Send '' (empty string) to clear a previously set URL.
  @ApiPropertyOptional({ example: 'https://mysite.com', description: 'Must be https. Send empty string to clear.' })
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_tld: true, require_protocol: true })
  @MaxLength(255)
  website?: string;

  /**
   * Whether the profile body is hidden from non-followers.
   */
  @ApiPropertyOptional({ example: false, description: 'When true, non-followers see only handle, name, avatar, and account type.' })
  @IsOptional()
  @IsBoolean()
  is_private?: boolean;

  // Replaces the full set atomically - send [] to clear all genres.
  @ApiPropertyOptional({ type: [String], example: ['electronic', 'jazz'], description: 'Replaces genre set atomically. Max 5. Send [] to clear.' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @IsIn(ALLOWED_GENRES as unknown as string[], { each: true })
  favorite_genres?: string[];

  /**
   * Switch between LISTENER and ARTIST profile types.
   * Artists get additional public fields (e.g. track count).
   */
  @ApiPropertyOptional({ enum: AccountType, example: AccountType.ARTIST, description: 'LISTENER or ARTIST. Artists expose track count.' })
  @IsOptional()
  @IsEnum(AccountType, {
    message: 'account_type must be either LISTENER or ARTIST.',
  })
  account_type?: AccountType;
}

// =============================================================================
// CheckHandleQueryDto
// =============================================================================

export class CheckHandleQueryDto {
  @ApiProperty({ example: 'yahia_dev', description: 'Handle to check (3–30 chars, lowercase letters, numbers, underscores).' })
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
  @ApiProperty({ example: 'instagram', enum: ALLOWED_PLATFORMS, description: 'Social platform slug.' })
  @IsString()
  @IsEnum(ALLOWED_PLATFORMS, {
    message: `platform must be one of: ${ALLOWED_PLATFORMS.join(', ')}`,
  })
  platform!: PlatformSlug;

  @ApiProperty({ example: 'https://instagram.com/yahia_dev', description: 'Must be https.' })
  @IsUrl({ protocols: ['https'], require_tld: true, require_protocol: true })
  @MaxLength(2048)
  url!: string;

  // Defaults to insertion order if omitted.
  @ApiPropertyOptional({ example: 0, description: 'Display order (0-based). Defaults to insertion order.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sort_order?: number;
}

// =============================================================================
// UpdateExternalLinksDto
// =============================================================================

// Full-replace - client sends the complete desired list; existing links are dropped.
export class UpdateExternalLinksDto {
  @ApiProperty({ type: [ExternalLinkItemDto], description: 'Complete desired link list. Send [] to clear all. Max 10 links.' })
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
  @ApiProperty({ enum: ['avatar', 'cover'], example: 'avatar', description: 'avatar = profile picture (max 5 MB), cover = banner image (max 15 MB).' })
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
  @ApiProperty({ example: 'yahia_dev', description: 'The profile handle to look up.' })
  @IsString()
  @IsNotEmpty()
  @Matches(HANDLE_REGEX, {
    message: 'handle must be a valid profile handle.',
  })
  handle!: string;
}
