import { useState } from "react";
import type { OrgActivityEvent } from "@soupnet/domain/browser";
import {
  AdminLayout,
  AdminPageHeader,
  AdminEmptyState,
  AdminTable,
  AdminPagination,
  fmtAdminDate,
  useAdminGate,
  useAdminListQuery,
  type AdminColumn,
} from "../components/admin/index.js";
import { describeOrgEvent } from "../lib/org-activity-copy.js";

const PAGE_SIZE = 50;

/**
 * The org console's Activity page (/org/activity): admin actions on the
 * organization and its members, never anyone's own activity (CN-L1).
 */
export function OrgActivityPage() {
  const { gate, isAdmin, organizationId } = useAdminGate("org");
  const [offset, setOffset] = useState(0);
  const enabled = isAdmin && organizationId !== null;

  const overview = useAdminListQuery<{ name: string }>({
    queryKey: ["org", organizationId, "overview"],
    path: `/organizations/${organizationId}`,
    enabled,
    failure: "Failed to load the organization",
  });
  const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  const activity = useAdminListQuery<{ events: OrgActivityEvent[] }>({
    queryKey: ["org", organizationId, "activity"],
    path: `/organizations/${organizationId}/activity`,
    params,
    enabled,
    failure: "Failed to load activity",
  });

  if (gate) return gate;

  const events = activity.data?.events ?? [];
  const columns: AdminColumn<OrgActivityEvent & { key: string }>[] = [
    { key: "at", header: "When", render: (e) => <span style={{ color: "var(--color-on-surface-variant)" }}>{fmtAdminDate(e.at)}</span> },
    { key: "actor", header: "Who", render: (e) => <span>{e.actor}</span> },
    { key: "what", header: "What", render: (e) => <span>{describeOrgEvent(e, "org")}</span> },
  ];

  return (
    <AdminLayout scope="org" heading={overview.data?.name}>
      <AdminPageHeader title="Activity" subtitle="What owners, admins and Soup.net did in the organization. Members see the actions that touched their own account." />
      <div style={{ padding: "0 var(--space-lg) var(--space-lg)" }}>
        {activity.error ? (
          <div style={{ color: "var(--color-error, #ef4444)" }}>{(activity.error as Error).message}</div>
        ) : (
          <>
            <AdminTable
              rows={events.map((e, i) => ({ ...e, key: `${offset + i}` }))}
              columns={columns}
              rowKey={(e) => e.key}
              empty={<AdminEmptyState title="Nothing yet" body="Joins, role changes, disables and sharing changes appear here." />}
            />
            <AdminPagination
              total={offset + events.length + (events.length === PAGE_SIZE ? 1 : 0)}
              offset={offset}
              pageSize={PAGE_SIZE}
              onOffsetChange={setOffset}
            />
          </>
        )}
      </div>
    </AdminLayout>
  );
}
