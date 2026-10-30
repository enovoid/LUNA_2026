import { type Db, imageFiles } from '@luna/db';
import { eq, inArray, like } from 'drizzle-orm';

export interface ObjectStore {
  exists(key: string): Promise<boolean>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  listKeys(prefix: string): Promise<string[]>;
  deleteKeys(keys: readonly string[]): Promise<void>;
}

/**
 * WebP 파일을 Postgres `image_files`에 둔다. 사이트 빌드가 꺼내 정적 파일로 함께 배포하므로
 * 별도 오브젝트 스토리지가 필요 없다.
 */
export class PostgresImageStore implements ObjectStore {
  constructor(private readonly db: Db) {}

  async exists(key: string): Promise<boolean> {
    const rows = await this.db
      .select({ key: imageFiles.key })
      .from(imageFiles)
      .where(eq(imageFiles.key, key));
    return rows.length > 0;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    // 키가 내용 해시라 같은 키의 내용은 절대 바뀌지 않는다. 이미 있으면 그대로 둔다.
    await this.db.insert(imageFiles).values({ key, body, contentType }).onConflictDoNothing();
  }

  async listKeys(prefix: string): Promise<string[]> {
    // 접두어는 `members/` 같은 고정 문자열이라 LIKE 특수 문자가 없다.
    const rows = await this.db
      .select({ key: imageFiles.key })
      .from(imageFiles)
      .where(like(imageFiles.key, `${prefix}%`));
    return rows.map((row) => row.key);
  }

  async deleteKeys(keys: readonly string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 1000) {
      await this.db.delete(imageFiles).where(inArray(imageFiles.key, keys.slice(i, i + 1000)));
    }
  }
}
