import { Exclude, Expose, Type } from 'class-transformer';

@Exclude()
export class PlaylistOwnerEntity {
  @Expose()
  id!: string;

  @Expose()
  display_name!: string;
}

@Exclude()
export class PlaylistTrackEntity {
  @Expose()
  trackId!: string;

  @Expose()
  title!: string;
}

@Exclude()
export class PlaylistEntity {
  @Expose()
  playlistId!: string;

  @Expose()
  title!: string;

  @Expose()
  description!: string | null;

  @Expose()
  visibility!: string;

  @Expose({ groups: ['owner'] })
  secretToken!: string | null;

  @Expose()
  @Type(() => PlaylistOwnerEntity)
  owner!: PlaylistOwnerEntity;

  @Expose()
  @Type(() => PlaylistTrackEntity)
  tracks!: PlaylistTrackEntity[];
}
