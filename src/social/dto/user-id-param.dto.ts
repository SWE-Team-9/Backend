import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, Matches } from "class-validator";

const USER_ID_REGEX = /^usr_[a-zA-Z0-9_-]+$/;

export class UserIdParamDto {
  // TODO(Module 3): Replace regex with centralized user-id validator once shared DTO utilities are added.
  @ApiProperty({
    example: "usr_456",
    description: "Target user ID in project format (usr_*).",
  })
  @IsString()
  @IsNotEmpty()
  @Matches(USER_ID_REGEX, {
    message: "userId must match project format like usr_456",
  })
  userId!: string;
}
