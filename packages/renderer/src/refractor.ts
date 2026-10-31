// The OpenUI CodeBlock imports `refractor/all`, which has about 300 Prism
// languages. Vite aliases that import to this file: the common languages of
// refractor and some more that pages often use. A code block in another
// language shows as plain text.
import { refractor } from "refractor";
import docker from "refractor/docker";
import graphql from "refractor/graphql";
import jsx from "refractor/jsx";
import powershell from "refractor/powershell";
import toml from "refractor/toml";
import tsx from "refractor/tsx";

for (const syntax of [docker, graphql, jsx, powershell, toml, tsx]) refractor.register(syntax);

export { refractor };
