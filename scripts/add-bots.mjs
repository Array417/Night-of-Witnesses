import WebSocket from 'ws';

const DEFAULT_NAMES = ['Bot 1', 'Bot 2', 'Bot 3'];
const roomCode = process.argv[2]?.trim().toUpperCase();
const names = process.argv.slice(3);
const botNames = names.length === 0 ? DEFAULT_NAMES : names;
const wsUrl = process.env.WS_URL || `ws://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || '3000'}/ws`;
const origin = process.env.ORIGIN || 'http://127.0.0.1:3000';

if (!roomCode || roomCode.length !== 6 || botNames.length !== 3) {
  console.error('Usage: npm run add-bots -- ROOMCODE [BOT1 BOT2 BOT3]');
  process.exit(1);
}

function joinBot(name) {
  const socket = new WebSocket(wsUrl, { headers: { Origin: origin } });

  return new Promise((resolve, reject) => {
    let welcomed = false;
    let resolved = false;
    let lastProjection;
    let sentVersion = -1;

    const sendAction = (projection, action) => {
      if (sentVersion === projection.version) return;
      sentVersion = projection.version;
      socket.send(
        JSON.stringify({
          ...action,
          actionId: crypto.randomUUID(),
          baseVersion: projection.version,
        })
      );
    };

    const act = (projection) => {
      lastProjection = projection;
      const player = projection.players.find((candidate) => candidate.playerId === projection.viewerId);
      if (!player) return;

      if (projection.phase === 'lobby' && !player.ready) {
        sendAction(projection, { type: 'set_ready', ready: true });
        return;
      }

      if (projection.phase === 'draft' && projection.currentActorId === projection.viewerId) {
        const cards = projection.ownCards || [];
        const nextPlayer = projection.players.find(
          (candidate) => !projection.servedPlayerIds.includes(candidate.playerId)
        );
        if (cards.length === 2 && (nextPlayer || projection.servedPlayerIds.length === projection.players.length)) {
          sendAction(projection, {
            type: 'choose_and_pass',
            keepCardId: cards[0].id,
            ...(nextPlayer ? { passToPlayerId: nextPlayer.playerId } : {}),
          });
        }
        return;
      }

      if (projection.phase === 'discussion') {
        if (projection.ownRole?.role === 'butler' && !projection.butlerPeek) {
          sendAction(projection, { type: 'butler_peek' });
          return;
        }
        if (projection.ownRole?.role === 'detective' && !projection.detectiveSentLocation) {
          const target = projection.players.find((candidate) => candidate.locationId)?.locationId;
          if (target) {
            sendAction(projection, { type: 'detective_send', targetLocation: target });
          }
        }
        return;
      }

      if (projection.phase === 'voting' && !player.hasVoted) {
        const target = projection.players.find((candidate) => candidate.locationId)?.locationId;
        if (target) {
          sendAction(projection, { type: 'cast_vote', targetLocation: target });
        }
      }
    };

    const fail = (error) => {
      if (!resolved) {
        resolved = true;
        socket.close();
        reject(error);
      }
    };

    const finish = () => {
      if (!resolved) {
        resolved = true;
        resolve(socket);
      }
    };

    socket.once('open', () => {
      socket.send(
        JSON.stringify({
          type: 'join_room',
          actionId: crypto.randomUUID(),
          roomCode,
          playerName: name,
        })
      );
    });
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong' }));
      } else if (message.type === 'welcome') {
        welcomed = true;
        console.log(`${name} joined ${message.roomCode}`);
      } else if (message.type === 'projection') {
        act(message.projection);
        const player = message.projection.players.find(
          (candidate) => candidate.playerId === message.projection.viewerId
        );
        if (player?.ready) finish();
      } else if (message.type === 'error') {
        if (message.code === 'STALE_VERSION' && lastProjection) {
          sentVersion = -1;
          act(lastProjection);
          return;
        }
        fail(new Error(`${name}: ${message.message}`));
      }
    });
    socket.once('error', fail);
    socket.once('close', () => fail(new Error(`${name}: connection closed`)));
  });
}

const sockets = [];

try {
  for (const name of botNames) {
    sockets.push(await joinBot(name));
  }
  console.log('All bots are ready. Press Ctrl+C to stop them.');
} catch (error) {
  for (const socket of sockets) {
    socket.close();
  }
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

process.on('SIGINT', () => {
  for (const socket of sockets) {
    socket.close();
  }
  process.exit(0);
});
