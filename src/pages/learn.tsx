/**
 * Placeholder route page for learning resources.
 */

import { PageHeader, EmptyState } from "@/components/layout/page-blocks";

/** Renders the Learn page header with an empty state until resources are added. */
export default function Learn() {
  return (
    <div>
      <PageHeader title="Learn" description="Guides and reference material for mobile app security testing." />
      <EmptyState title="Learning resources haven't been added yet." />
    </div>
  );
}
