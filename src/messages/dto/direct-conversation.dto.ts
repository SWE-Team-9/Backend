import { IsUUID } from "class-validator";

export class DirectConversationDto {
  @IsUUID()
  receiverId!: string;
}
