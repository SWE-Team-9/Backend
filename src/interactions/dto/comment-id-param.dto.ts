import { ApiProperty } from "@nestjs/swagger";
import { IsNotEmpty, IsString, Matches } from "class-validator";

const COMMENT_ID_REGEX = /^cmt_[a-zA-Z0-9_-]+$/;

export class CommentIdParamDto {
  // TODO(Module 6): Replace local regex with shared CommentId validator when common DTO utilities are added.
  @ApiProperty({ example: "cmt_123", description: "Comment ID in project format (cmt_*)." })
  @IsString()
  @IsNotEmpty()
  @Matches(COMMENT_ID_REGEX, {
    message: "commentId must match project format like cmt_123",
  })
  commentId!: string;
}
