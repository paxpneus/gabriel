import { Router, RequestHandler, Request } from "express";
import { QueryParams } from "../../query/query.types";

abstract class RouterController {
  public router: Router;

  constructor() {
    this.router = Router();
  }

  protected middlewaresFor(): Record<string, RequestHandler[]> {
    return {};
  }

  protected mw(key: string): RequestHandler[] {
    return this.middlewaresFor()[key] ?? [];
  }

  protected extractQueryParams(req: Request): QueryParams {
    const q = req.query as Record<string, any>;
    return {
      page: q.page,
      perPage: q.perPage,
      sortBy: q.sortBy,
      sortDir: q.sortDir,
      search: q.search,
      filters: q.filters,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      dateField: q.dateField,
      userId: q.userId,
    };
  }
}

export default RouterController;