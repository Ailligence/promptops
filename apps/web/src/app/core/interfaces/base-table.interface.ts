export interface BaseTableFilter {
  searchQuery: string | null;
  page: number | null;
  perPage: number | null;
  fieldSort: string | null;
  fieldDir: string | null;
  suggest: boolean | null;

  [key: string]: any;
}
export interface SortInterface {
  column: string;
  direction: string;
}

export interface PaginationInterface {
  page: number;
  pageSize: number;
}
