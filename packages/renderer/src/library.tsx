// The OpenUI library with the changes that a complete, non-streamed page needs.
import type { ComponentRenderProps, SubComponentOf } from "@openuidev/react-lang";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@openuidev/react-ui";
import { openuiLibrary } from "@openuidev/react-ui/genui-lib";
import { useState } from "react";

type TabItem = SubComponentOf<{ value: string; trigger: string; content: unknown[] }>;

/**
 * Tabs that open on the first tab. The upstream renderer selects the tab whose content grew last,
 * to follow a streamed answer. A page arrives complete, so every tab grows at once and the last tab won.
 */
function FirstTabs({ props, renderNode }: ComponentRenderProps<{ items: TabItem[] }>) {
	const items = (props.items ?? []).filter((item) => item?.props?.value != null);
	const [active, setActive] = useState<string | null>(null);
	if (!items.length) return null;
	// A tab that is gone (another page in the same place) falls back to the first tab.
	const value = items.some((item) => item.props.value === active) ? (active as string) : items[0].props.value;

	return (
		<Tabs value={value} onValueChange={setActive}>
			<TabsList>
				{items.map((item) => (
					<TabsTrigger key={item.props.value} value={item.props.value} text={item.props.trigger} />
				))}
			</TabsList>
			{items.map((item) => (
				<TabsContent key={item.props.value} value={item.props.value}>
					{renderNode(item.props.content)}
				</TabsContent>
			))}
		</Tabs>
	);
}

/** The library that the renderer draws pages with. The schema is the same as `openuiLibrary`. */
export const library = openuiLibrary.extend({
	components: { override: [{ ...openuiLibrary.components.Tabs, component: FirstTabs }] },
});
