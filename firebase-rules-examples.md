# Firebase Security Rules Examples

These examples match the hybrid architecture in this project.

## Realtime Database

Realtime Database stores only the hot live feed at `liveMatches/{matchId}`: score, wickets, overs, striker/non-striker, current bowler, ball timeline, commentary, live status, and viewer presence.

```json
{
  "rules": {
    "liveMatches": {
      "$matchId": {
        ".read": true,
        ".write": "auth != null && auth.token.admin == true",
        "viewers": {
          "$viewerId": {
            ".read": true,
            ".write": true,
            ".validate": "newData.hasChildren(['online'])"
          }
        },
        ".indexOn": ["updatedAt", "liveStatus"]
      }
    }
  }
}
```

## Cloud Firestore

Firestore stores permanent structured data: teams, players, match history, completed matches, league schedule, points table, admin settings, users, tournament stats, and saved links.

```js
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function isAdmin() {
      return request.auth != null && request.auth.token.admin == true;
    }

    match /teams/{docId} {
      allow read: if true;
      allow write: if isAdmin();
    }

    match /players/{playerId} {
      allow read: if true;
      allow write: if isAdmin();
    }

    match /matchHistory/{matchId} {
      allow read: if true;
      allow write: if isAdmin();
    }

    match /completedMatches/{matchId} {
      allow read: if true;
      allow write: if isAdmin();
    }

    match /league/{leagueId} {
      allow read: if true;
      allow write: if isAdmin();
    }

    match /settings/{settingId} {
      allow read: if isAdmin();
      allow write: if isAdmin();
    }

    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      allow read, write: if isAdmin();
    }

    match /tournamentStats/{statId} {
      allow read: if true;
      allow write: if isAdmin();
    }

    match /savedLinks/{matchId} {
      allow read, write: if isAdmin();
    }

    // Legacy compatibility mirror used by older scorecard links. Live scores do not use this path.
    match /matches/{matchId} {
      allow read: if true;
      allow write: if isAdmin();
    }
  }
}
```
