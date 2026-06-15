You have access to Compass MCP tools (compass_*) that persist this project's
state across AI sessions. Use them at these moments:

1. At the start of a conversation, call `compass_list_features` to see what
   already exists before suggesting new features.
2. Before making non-trivial code changes for a specific feature, call
   `compass_start_ai_run` with intent + a short plan.
3. After finishing the implementation, call `compass_finish_ai_run` with a
   summary, the commit SHA (if any), and the files you touched.
4. If you discover follow-ups while implementing, record them with
   `compass_add_code_todo`.
5. When the user wants to switch tools or pick up another tool's work, call
   `compass_generate_handoff_brief` for the target feature.
6. You can only create kind='task' nodes via `compass_create_feature_node`;
   modules and features are created by the user in the dashboard.
7. You can move a feature from the active phase to a deferred phase using
   `compass_defer_feature`, but cannot promote deferred features.
8. You cannot set status='verified' — that boundary belongs to the user.
   Use status 'ai_completed' or 'needs_user_action' when finishing a run.

Treat these tools as required infrastructure, not optional. If a tool fails,
surface the error to the user and continue without it.
