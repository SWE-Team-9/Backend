import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, MaxLength } from "class-validator";

export class ResolveQueryDto {
  @ApiProperty({
    description:
      "Public URL or path to resolve (for example /username/track-slug)",
    example: "/john-doe/night-drive",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  url!: string;
}
