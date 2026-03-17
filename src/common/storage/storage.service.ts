import { Injectable } from "@nestjs/common";

// TODO: Member 5

export type UploadType = "avatar" | "cover";

export interface UploadResult {
  url: string;
  key: string;
}

@Injectable()
export class StorageService {}
