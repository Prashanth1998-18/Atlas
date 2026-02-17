import React from "react";
import ChatPanel from "./ChatPanel";
import { EmptyState } from "./EmptyState";
import { useConversationStore } from "../store/conversationStore";
import { useWorkspaceStore } from "../store/workspaceStore";

export const ChatArea = () => {
  const { currentConversationId, setCurrentConversationId, addConversation } = useConversationStore();
  const { currentWorkspace } = useWorkspaceStore();

  const handleConversationCreated = (id: string) => {
    addConversation({
      id,
      workspaceId: "",
      title: "New Chat",
      createdAt: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
    });
    setCurrentConversationId(id);
  };

  // Show EmptyState when no workspace is open
  if (!currentWorkspace) {
    return <EmptyState />;
  }

  return (
    <ChatPanel
      conversationId={currentConversationId}
      onConversationCreated={handleConversationCreated}
    />
  );
};
