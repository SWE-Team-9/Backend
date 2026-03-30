import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, Matches } from "class-validator";

const USER_ID_REGEX = /^usr_[a-zA-Z0-9_-]+$/;

export class UserIdParamDto {
  // TODO(Module 4): Replace local regex with shared UserId validator once common DTO utils exist.
  @ApiProperty({
    example: "usr_456",
    description: "Artist user ID in project format (usr_*).",
  })
  @IsString()
  @IsNotEmpty()
  @Matches(USER_ID_REGEX, {
    message: "userId must match project format like usr_456",
  })
  userId!: string;
}
