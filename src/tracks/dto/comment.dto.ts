import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from "class-validator";

export class CreateCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content!: string;

  @IsInt()
  @Min(0)
  timestampAt!: number;
}
