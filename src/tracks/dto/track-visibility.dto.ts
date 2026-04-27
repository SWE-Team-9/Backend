import { IsEnum } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { TrackVisibility } from "@prisma/client";

export class TrackVisibilityDto {
  @ApiProperty({
    description: "Track visibility",
    enum: TrackVisibility,
    example: "PUBLIC",
  })
  @IsEnum(TrackVisibility)
  visibility!: TrackVisibility;
}
