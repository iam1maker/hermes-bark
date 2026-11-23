"""hermes-bark — Bark iOS push as a first-class Hermes delivery platform.

Send-only by design: Bark is APNs push with no reply channel, so this plugin
never registers an inbound stream. It exists to give Hermes four delivery
surfaces a skill cannot reach: cron ``deliver=bark``, ``hermes send --to bark``,
the in-session ``send_message`` tool, and turn/subagent lifecycle hooks.
"""

from .adapter import register

__all__ = ["register"]
