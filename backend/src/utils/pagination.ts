import { z } from "zod";

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type Pagination = z.infer<typeof paginationSchema>;

export function toSkipTake(pagination: Pagination): { skip: number; take: number } {
  return { skip: (pagination.page - 1) * pagination.pageSize, take: pagination.pageSize };
}

export function paginatedResponse<T>(items: T[], total: number, pagination: Pagination) {
  return {
    items,
    meta: {
      total,
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
    },
  };
}
