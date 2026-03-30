import { ApiProperty } from "@nestjs/swagger";
import { IsIn, IsString } from "class-validator";

export class ChangeTrackVisibilityDto {
  // TODO(Module 4): Revisit enum values if product removes or renames LINK-ONLY state.
  @ApiProperty({
    example: "PRIVATE",
    enum: ["PUBLIC", "PRIVATE", "LINK-ONLY"],
    description: "Allowed visibility values.",
  })
  @IsString()
  @IsIn(["PUBLIC", "PRIVATE", "LINK-ONLY"])
  visibility!: "PUBLIC" | "PRIVATE" | "LINK-ONLY";
}
