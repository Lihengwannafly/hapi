import { useState, useEffect, useRef, type FC } from 'react'
import { useAssistantState } from '@assistant-ui/react'
import { cn } from '@/lib/utils'

function ChevronIcon(props: { className?: string; open?: boolean }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={cn(
                'transition-transform duration-200',
                props.open ? 'rotate-90' : '',
                props.className
            )}
        >
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
}

function ShimmerDot() {
    return (
        <span className="inline-block w-1.5 h-1.5 bg-current rounded-full animate-pulse" />
    )
}

type ReasoningPart = {
    type: 'reasoning'
    text: string
    status?: { type: string }
}

/**
 * Renders all reasoning content from the message in a single collapsible block.
 * Auto-expands while streaming, auto-collapses when done.
 */
export const ThinkingBlock: FC = () => {
    const [isOpen, setIsOpen] = useState(false)
    const didUserToggleRef = useRef(false)

    // Get all reasoning parts from the message
    const reasoningParts = useAssistantState(({ message }) => {
        return message.content.filter((part): part is ReasoningPart => part.type === 'reasoning')
    })

    // Check if any reasoning is still streaming
    const messageStatus = useAssistantState(({ message }) => message.status)
    const isStreaming = messageStatus?.type === 'running'
        && reasoningParts.some(part => part.status?.type === 'running')

    const prevIsStreamingRef = useRef(false)

    // Auto-expand while streaming; auto-collapse once finalized
    useEffect(() => {
        const wasStreaming = prevIsStreamingRef.current
        prevIsStreamingRef.current = isStreaming

        if (isStreaming) {
            if (!didUserToggleRef.current) {
                setIsOpen(true)
            }
            return
        }

        if (wasStreaming) {
            setIsOpen(false)
            didUserToggleRef.current = false
        }
    }, [isStreaming])

    // Don't render if no reasoning parts
    if (reasoningParts.length === 0) {
        return null
    }

    // Combine all reasoning text
    const combinedText = reasoningParts.map(part => part.text).join('\n\n')

    return (
        <div className="aui-thinking-block my-2">
            <button
                type="button"
                onClick={() => {
                    didUserToggleRef.current = true
                    setIsOpen((prev) => !prev)
                }}
                className={cn(
                    'flex items-center gap-1.5 text-xs font-medium',
                    'text-[var(--app-hint)] hover:text-[var(--app-fg)]',
                    'transition-colors cursor-pointer select-none'
                )}
            >
                <ChevronIcon open={isOpen} />
                <span>Thinking</span>
                {isStreaming && (
                    <span className="flex items-center gap-1 ml-1 text-[var(--app-hint)]">
                        <ShimmerDot />
                    </span>
                )}
            </button>

            <div
                className={cn(
                    'overflow-hidden transition-all duration-200 ease-in-out',
                    isOpen ? 'max-h-[10000px] opacity-100' : 'max-h-0 opacity-0'
                )}
            >
                <div className="pl-4 pt-2 border-l-2 border-[var(--app-border)] ml-0.5">
                    <div className="aui-thinking-content min-w-0 max-w-full break-words text-sm text-[var(--app-hint)] whitespace-pre-wrap">
                        {combinedText}
                    </div>
                </div>
            </div>
        </div>
    )
}
