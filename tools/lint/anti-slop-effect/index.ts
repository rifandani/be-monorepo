import { eslintCompatPlugin } from "@oxlint/plugins";

import { boundedOwnedConcurrencyRule } from "./rules/bounded-owned-concurrency.ts";
import { boundedRetryRule } from "./rules/bounded-retry.ts";
import { noDefectSwallowingRule } from "./rules/no-defect-swallowing.ts";
import { noManualEffectErrorTagRule } from "./rules/no-manual-effect-error-tag.ts";
import { noManualTagComparisonRule } from "./rules/no-manual-tag-comparison.ts";
import { noManualTaggedConstructionRule } from "./rules/no-manual-tagged-construction.ts";
import { noManualTaggedTypeRule } from "./rules/no-manual-tagged-type.ts";
import { noServiceConstructorImportsRule } from "./rules/no-service-constructor-imports.ts";
import { preferEffectMatchRule } from "./rules/prefer-effect-match.ts";
import { preferTaggedErrorHandlingRule } from "./rules/prefer-tagged-error-handling.ts";
import { provideLayersAtCompositionRule } from "./rules/provide-layers-at-composition.ts";
import { requireCauseWhenNarrowingRule } from "./rules/require-cause-when-narrowing.ts";
import { requireOperationSpanRule } from "./rules/require-operation-span.ts";
import { requireScopedResourceRule } from "./rules/require-scoped-resource.ts";
import { resolveDependenciesAtConstructionRule } from "./rules/resolve-dependencies-at-construction.ts";

const antiSlopEffectPlugin = eslintCompatPlugin({
  meta: { name: "anti-slop-effect" },
  rules: {
    "bounded-owned-concurrency": boundedOwnedConcurrencyRule,
    "bounded-retry": boundedRetryRule,
    "no-defect-swallowing": noDefectSwallowingRule,
    "no-manual-effect-error-tag": noManualEffectErrorTagRule,
    "no-manual-tag-comparison": noManualTagComparisonRule,
    "no-manual-tagged-construction": noManualTaggedConstructionRule,
    "no-service-constructor-imports": noServiceConstructorImportsRule,
    "prefer-effect-match": preferEffectMatchRule,
    "no-manual-tagged-type": noManualTaggedTypeRule,
    "prefer-tagged-error-handling": preferTaggedErrorHandlingRule,
    "provide-layers-at-composition": provideLayersAtCompositionRule,
    "require-operation-span": requireOperationSpanRule,
    "require-scoped-resource": requireScopedResourceRule,
    "resolve-dependencies-at-construction":
      resolveDependenciesAtConstructionRule,
    "require-cause-when-narrowing": requireCauseWhenNarrowingRule,
  },
});

export default antiSlopEffectPlugin;
