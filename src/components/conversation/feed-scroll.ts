/**
 * Scroll pinning for the risk conversation feed: stay on the newest item unless the reader scrolled away.
 */

import { useCallback, useEffect, useRef, useState, type RefObject, type UIEvent } from "react";
import { createDebug } from "@/lib/debug";

const debug = createDebug("components:conversation:feed-scroll");

export interface FeedScroll {
  feedRef: RefObject<HTMLDivElement>;
  highlightedRef: RefObject<HTMLLIElement>;
  hasUnread: boolean;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
  scrollToLatest: () => void;
}

/** Keeps the feed pinned to the newest item unless the reader scrolled away, and scrolls to a highlighted run. */
export function useFeedScroll(itemCount: number, highlightRunTimestamp: string | undefined): FeedScroll {
  const [hasUnread, setHasUnread] = useState(false);
  const highlightedRef = useRef<HTMLLIElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const pinnedToLatest = useRef(true);
  const seenCount = useRef(0);

  /** Scrolls the feed to the newest item and clears the unread indicator. */
  const scrollToLatest = useCallback(() => {
    const feed = feedRef.current;
    if (!feed) return;
    feed.scrollTop = feed.scrollHeight;
    pinnedToLatest.current = true;
    setHasUnread(false);
  }, []);

  useEffect(() => {
    if (itemCount <= seenCount.current) {
      seenCount.current = itemCount;
      return;
    }
    const isFirstFill = seenCount.current === 0;
    debug("receives items", { count: itemCount, isFirstFill, pinned: pinnedToLatest.current });
    seenCount.current = itemCount;
    if (isFirstFill || pinnedToLatest.current) scrollToLatest();
    else setHasUnread(true);
  }, [itemCount, scrollToLatest]);

  useEffect(() => {
    if (highlightRunTimestamp) {
      debug("scrolls to highlighted run", { runTimestamp: highlightRunTimestamp });
      highlightedRef.current?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    }
  }, [highlightRunTimestamp, itemCount]);

  /** Tracks whether the feed is pinned near the bottom so new items auto-scroll. */
  function onScroll(event: UIEvent<HTMLDivElement>) {
    const feed = event.currentTarget;
    const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
    pinnedToLatest.current = nearBottom;
    if (nearBottom) setHasUnread(false);
  }

  return { feedRef, highlightedRef, hasUnread, onScroll, scrollToLatest };
}
