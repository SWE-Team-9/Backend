export class CreatePlaylistDto {
  title!: string;
  description?: string;
  // Keep as string placeholder for now; expected values are PUBLIC or SECRET.
  visibility!: string;
}
