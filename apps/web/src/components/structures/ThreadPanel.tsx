/*
Copyright 2024 New Vector Ltd.
Copyright 2021-2023 The Matrix.org Foundation C.I.C.

SPDX-License-Identifier: AGPL-3.0-only OR GPL-3.0-only OR LicenseRef-Element-Commercial
Please see LICENSE files in the repository root for full details.
*/

import React, { useContext, useEffect, useRef, useState } from "react";
import { type EventTimelineSet, type Room, Thread } from "matrix-js-sdk/src/matrix";
import { IconButton, NavBar, NavItem, Tooltip } from "@vector-im/compound-web";
import { logger } from "matrix-js-sdk/src/logger";
import { ThreadsIcon } from "@vector-im/compound-design-tokens/assets/web/icons";

import MarkAllThreadsReadIcon from "../../../res/img/element-icons/check-all.svg?react";
import BaseCard from "../views/right_panel/BaseCard";
import type ResizeNotifier from "../../utils/ResizeNotifier";
import MatrixClientContext, { useMatrixClientContext } from "../../contexts/MatrixClientContext";
import { _t } from "../../languageHandler";
import RoomContext, { TimelineRenderingType } from "../../contexts/RoomContext";
import TimelinePanel from "./TimelinePanel";
import { Layout } from "../../settings/enums/Layout";
import { type RoomPermalinkCreator } from "../../utils/permalinks/Permalinks";
import Measured from "../views/elements/Measured";
import PosthogTrackers from "../../PosthogTrackers";
import Spinner from "../views/elements/Spinner";
import { clearRoomNotification } from "../../utils/notifications";
import EmptyState from "../views/right_panel/EmptyState";
import { ScopedRoomContextProvider, useScopedRoomContext } from "../../contexts/ScopedRoomContext.tsx";
import { EventPresentationContextProvider } from "../../utils/EventPresentationContextProvider";

interface IProps {
    roomId: string;
    onClose: () => void;
    resizeNotifier: ResizeNotifier;
    permalinkCreator: RoomPermalinkCreator;
}

export enum ThreadFilterType {
    My,
    All,
}

const THREAD_PANEL_TABPANEL_ID = "mx_ThreadPanel_panel";
const THREAD_PANEL_TAB_IDS: Record<ThreadFilterType, string> = {
    [ThreadFilterType.All]: "mx_ThreadPanel_tab_all",
    [ThreadFilterType.My]: "mx_ThreadPanel_tab_my",
};

export const ThreadPanelHeader: React.FC<{
    filterOption: ThreadFilterType;
    setFilterOption: (filterOption: ThreadFilterType) => void;
}> = ({ filterOption, setFilterOption }) => {
    const mxClient = useMatrixClientContext();
    const roomContext = useScopedRoomContext("room");

    const onMarkAllThreadsReadClick = React.useCallback(
        (e: React.MouseEvent) => {
            PosthogTrackers.trackInteraction("WebThreadsMarkAllReadButton", e);
            if (!roomContext.room) {
                logger.error("No room in context to mark all threads read");
                return;
            }
            // This actually clears all room notifications by sending an unthreaded read receipt.
            // We'd have to loop over all unread threads (pagninating back to find any we don't
            // know about yet) and send threaded receipts for all of them... or implement a
            // specific API for it. In practice, the user will have to be viewing the room to
            // see this button, so will have marked the room itself read anyway.
            clearRoomNotification(roomContext.room, mxClient).catch((e) => {
                logger.error("Failed to mark all threads read", e);
            });
        },
        [roomContext.room, mxClient],
    );

    return (
        <div className="mx_ThreadPanelHeader">
            <NavBar className="mx_ThreadPanel_tabs" role="tablist" aria-label={_t("threads|filter_tabs_label")}>
                {/* The filter tabs reuse the old dropdown's analytics name; the index tells them apart */}
                <NavItem
                    id={THREAD_PANEL_TAB_IDS[ThreadFilterType.All]}
                    aria-controls={THREAD_PANEL_TABPANEL_ID}
                    active={filterOption === ThreadFilterType.All}
                    onClick={(ev: React.MouseEvent<HTMLButtonElement>) => {
                        setFilterOption(ThreadFilterType.All);
                        PosthogTrackers.trackInteraction("WebRightPanelThreadPanelFilterDropdown", ev, 0);
                    }}
                >
                    {_t("threads|all_threads")}
                </NavItem>
                <NavItem
                    id={THREAD_PANEL_TAB_IDS[ThreadFilterType.My]}
                    aria-controls={THREAD_PANEL_TABPANEL_ID}
                    active={filterOption === ThreadFilterType.My}
                    onClick={(ev: React.MouseEvent<HTMLButtonElement>) => {
                        setFilterOption(ThreadFilterType.My);
                        PosthogTrackers.trackInteraction("WebRightPanelThreadPanelFilterDropdown", ev, 1);
                    }}
                >
                    {_t("threads|my_threads")}
                </NavItem>
            </NavBar>
            <Tooltip label={_t("threads|mark_all_read")}>
                <IconButton onClick={onMarkAllThreadsReadClick} size="28px" className="mx_ThreadPanel_markAllRead">
                    <MarkAllThreadsReadIcon height={20} width={20} />
                </IconButton>
            </Tooltip>
        </div>
    );
};

const ThreadPanel: React.FC<IProps> = ({ roomId, onClose, permalinkCreator }) => {
    const mxClient = useContext(MatrixClientContext);
    const roomContext = useContext(RoomContext);
    const timelinePanel = useRef<TimelinePanel | null>(null);
    const card = useRef<HTMLDivElement | null>(null);
    const closeButonRef = useRef<HTMLButtonElement | null>(null);

    const [filterOption, setFilterOption] = useState<ThreadFilterType>(ThreadFilterType.All);
    const [room, setRoom] = useState<Room | null>(null);
    const [narrow, setNarrow] = useState<boolean>(false);

    const timelineSet: EventTimelineSet | undefined =
        filterOption === ThreadFilterType.My ? room?.threadsTimelineSets[1] : room?.threadsTimelineSets[0];
    const hasThreads = Boolean(room?.threadsTimelineSets?.[0]?.getLiveTimeline()?.getEvents()?.length);

    useEffect(() => {
        const room = mxClient.getRoom(roomId);
        void room
            ?.createThreadsTimelineSets()
            .then(() => room.fetchRoomThreads())
            .then(() => {
                setFilterOption(ThreadFilterType.All);
                setRoom(room);
            });
    }, [mxClient, roomId]);

    useEffect(() => {
        if (timelineSet && !Thread.hasServerSideSupport) {
            timelinePanel.current?.refreshTimeline();
        }
    }, [timelineSet, timelinePanel]);

    return (
        <ScopedRoomContextProvider
            {...roomContext}
            timelineRenderingType={TimelineRenderingType.ThreadsList}
            showHiddenEvents={true}
            narrow={narrow}
        >
            <BaseCard
                header={_t("common|threads")}
                id="thread-panel"
                className="mx_ThreadPanel"
                ariaLabelledBy="thread-panel-tab"
                role="tabpanel"
                onClose={onClose}
                withoutScrollContainer={true}
                ref={card}
                closeButtonRef={closeButonRef}
            >
                {hasThreads && <ThreadPanelHeader filterOption={filterOption} setFilterOption={setFilterOption} />}
                <Measured sensor={card} onMeasurement={setNarrow} />
                {/* Keep the timeline mounted even with no threads so that new ones show up live.
                    It is only a tab panel when the header with the filter tabs is shown. */}
                <div
                    id={hasThreads ? THREAD_PANEL_TABPANEL_ID : undefined}
                    role={hasThreads ? "tabpanel" : undefined}
                    aria-labelledby={hasThreads ? THREAD_PANEL_TAB_IDS[filterOption] : undefined}
                    className="mx_ThreadPanel_tabPanel"
                >
                    {timelineSet ? (
                        <EventPresentationContextProvider layout={Layout.Group}>
                            <TimelinePanel
                                key={filterOption + ":" + (timelineSet.getFilter()?.filterId ?? roomId)}
                                ref={timelinePanel}
                                showReadReceipts={false} // No RR support in thread's list
                                manageReadReceipts={false} // No RR support in thread's list
                                manageReadMarkers={false} // No RM support in thread's list
                                sendReadReceiptOnLoad={false} // No RR support in thread's list
                                timelineSet={timelineSet}
                                showUrlPreview={false} // No URL previews at the threads list level
                                empty={
                                    <EmptyState
                                        Icon={ThreadsIcon}
                                        title={_t("threads|empty_title")}
                                        description={_t("threads|empty_description", {
                                            replyInThread: _t("action|reply_in_thread"),
                                        })}
                                    />
                                }
                                alwaysShowTimestamps={true}
                                layout={Layout.Group}
                                hideThreadedMessages={false}
                                hidden={false}
                                showReactions={false}
                                className="mx_RoomView_messagePanel"
                                membersLoaded={true}
                                permalinkCreator={permalinkCreator}
                                disableGrouping={true}
                            />
                        </EventPresentationContextProvider>
                    ) : (
                        <div className="mx_AutoHideScrollbar">
                            <Spinner />
                        </div>
                    )}
                </div>
            </BaseCard>
        </ScopedRoomContextProvider>
    );
};
export default ThreadPanel;
