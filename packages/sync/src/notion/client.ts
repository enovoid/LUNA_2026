import type {
  DataSourceObjectResponse,
  PageObjectResponse,
  QueryDataSourceParameters,
} from '@notionhq/client';
// SDK는 CommonJS라 Node ESM에서 이름으로 가져오면 실행 시 실패한다. 기본 내보내기로 받는다.
import notionSdk from '@notionhq/client';
import type { Logger } from '../logger.js';
import { RateLimitedQueue } from './rate-limit.js';

const { Client, isFullDatabase, isFullDataSource, isFullPage } = notionSdk;

/** 2026-03-11부터 `archived`가 `in_trash`로 바뀌었다. SDK 5.12 이상 필요. */
export const NOTION_VERSION = '2026-03-11';

export interface NotionSource {
  /** 사용자가 넣은 ID(데이터베이스 또는 data source). */
  configuredId: string;
  dataSourceId: string;
  schema: DataSourceObjectResponse;
}

export interface NotionReader {
  resolveSource(id: string): Promise<NotionSource>;
  /** since가 있으면 그 시각 이후 수정된 페이지만, 없으면 전부. 휴지통 페이지는 빠진다. */
  queryPages(dataSourceId: string, since: Date | undefined): Promise<PageObjectResponse[]>;
  /** 삭제 감지용. 살아 있는 모든 페이지의 ID만 모은다. */
  listPageIds(dataSourceId: string, titlePropertyId: string): Promise<Set<string>>;
}

export class NotionApi implements NotionReader {
  readonly #client: InstanceType<typeof Client>;
  readonly #queue: RateLimitedQueue;

  constructor(token: string, logger: Logger) {
    // 재시도는 SDK가 아니라 아래 대기열이 맡는다. SDK 재시도는 대기열을 거치지 않아 속도 제한을 넘길 수 있다.
    this.#client = new Client({ auth: token, notionVersion: NOTION_VERSION, retry: false });
    this.#queue = new RateLimitedQueue({
      requestsPerSecond: 3,
      maxAttempts: 8,
      fallbackDelayMs: 1000,
      onRetry: ({ attempt, status, delayMs }) =>
        logger.warn(
          `Notion ${status === 0 ? '연결 실패' : `${status} 응답`}, ${Math.round(delayMs / 100) / 10}초 뒤 다시 시도 (${attempt}회째)`,
        ),
    });
  }

  async resolveSource(id: string): Promise<NotionSource> {
    let dataSourceId = id;
    try {
      const database = await this.#queue.run(() =>
        this.#client.databases.retrieve({ database_id: id }),
      );
      if (isFullDatabase(database)) {
        if (database.data_sources.length !== 1) {
          throw new Error(
            `데이터베이스 ${id}에 data source가 ${database.data_sources.length}개 있습니다. 쓸 data source ID를 직접 넣어 주세요.`,
          );
        }
        dataSourceId = database.data_sources[0]!.id;
      }
    } catch (error) {
      // data source ID를 넣은 경우 databases.retrieve는 object_not_found를 준다.
      if ((error as { code?: string }).code !== 'object_not_found') throw error;
    }
    const schema = await this.#queue.run(() =>
      this.#client.dataSources.retrieve({ data_source_id: dataSourceId }),
    );
    if (!isFullDataSource(schema))
      throw new Error(`data source ${dataSourceId}의 속성을 읽을 수 없습니다`);
    return { configuredId: id, dataSourceId, schema };
  }

  async queryPages(dataSourceId: string, since: Date | undefined): Promise<PageObjectResponse[]> {
    const args: QueryDataSourceParameters = {
      data_source_id: dataSourceId,
      page_size: 100,
      result_type: 'page',
    };
    if (since) {
      args.filter = {
        timestamp: 'last_edited_time',
        last_edited_time: { on_or_after: since.toISOString() },
      };
    }
    return this.#paginate(args);
  }

  async listPageIds(dataSourceId: string, titlePropertyId: string): Promise<Set<string>> {
    // 속성을 제목 하나로 줄여 응답을 가볍게 한다.
    const pages = await this.#paginate({
      data_source_id: dataSourceId,
      page_size: 100,
      result_type: 'page',
      filter_properties: [titlePropertyId],
    });
    return new Set(pages.map((page) => page.id));
  }

  async #paginate(args: QueryDataSourceParameters): Promise<PageObjectResponse[]> {
    const pages: PageObjectResponse[] = [];
    let cursor: string | undefined;
    do {
      const response = await this.#queue.run(() =>
        this.#client.dataSources.query({ ...args, ...(cursor ? { start_cursor: cursor } : {}) }),
      );
      for (const result of response.results) {
        if (result.object === 'page' && isFullPage(result) && !result.in_trash) pages.push(result);
      }
      // 한 쿼리의 결과 상한(기본 1만 행)에 걸리면 목록이 잘린다. 잘린 목록으로 삭제하면 안 되니 멈춘다.
      if (
        (response as { request_status?: { type?: string } }).request_status?.type === 'incomplete'
      ) {
        throw new Error(
          `data source ${args.data_source_id} 조회 결과가 잘렸습니다(행 수 상한 초과)`,
        );
      }
      cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
    } while (cursor);
    return pages;
  }
}
