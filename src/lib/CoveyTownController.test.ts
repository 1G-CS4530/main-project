import { nanoid } from 'nanoid';
import { mock, mockDeep, mockReset } from 'jest-mock-extended';
import { Socket } from 'socket.io';
import TwilioVideo from './TwilioVideo';
import Player from '../types/Player';
import CoveyTownController from './CoveyTownController';
import CoveyTownListener from '../types/CoveyTownListener';
import { UserLocation } from '../CoveyTypes';
import PlayerSession from '../types/PlayerSession';
import { townSubscriptionHandler } from '../requestHandlers/CoveyTownRequestHandlers';
import CoveyTownsStore from './CoveyTownsStore';
import * as TestUtils from '../client/TestUtils';
import { BoundingBox, ServerConversationArea } from '../client/TownsServiceClient';

const mockTwilioVideo = mockDeep<TwilioVideo>();
jest.spyOn(TwilioVideo, 'getInstance').mockReturnValue(mockTwilioVideo);

function generateTestLocation(): UserLocation {
  return {
    rotation: 'back',
    moving: Math.random() < 0.5,
    x: Math.floor(Math.random() * 100),
    y: Math.floor(Math.random() * 100),
  };
}

const locationFromArea = (conversationArea: ServerConversationArea): UserLocation => ({
  x: conversationArea.boundingBox.x,
  y: conversationArea.boundingBox.y,
  rotation: 'front',
  moving: false,
  conversationLabel: conversationArea.label,
});

const sortArea = (conv1: ServerConversationArea, conv2: ServerConversationArea): number => conv1.label.localeCompare(conv2.label);

const areaFromLocation = (location: UserLocation): ServerConversationArea => ({
  boundingBox: {
    width: 1,
    height: 1,
    x: location.x,
    y: location.y,
  },
  label: location.conversationLabel ?? nanoid(),
  topic: nanoid(),
  occupantsByID: [],
});

describe('CoveyTownController', () => {
  beforeEach(() => {
    mockTwilioVideo.getTokenForTown.mockClear();
  });
  it('constructor should set the friendlyName property', () => {
    const townName = `FriendlyNameTest-${nanoid()}`;
    const townController = new CoveyTownController(townName, false);
    expect(townController.friendlyName)
      .toBe(townName);
  });
  describe('addPlayer', () => {
    it('should use the coveyTownID and player ID properties when requesting a video token',
      async () => {
        const townName = `FriendlyNameTest-${nanoid()}`;
        const townController = new CoveyTownController(townName, false);
        const newPlayerSession = await townController.addPlayer(new Player(nanoid()));
        expect(mockTwilioVideo.getTokenForTown).toBeCalledTimes(1);
        expect(mockTwilioVideo.getTokenForTown).toBeCalledWith(townController.coveyTownID, newPlayerSession.player.id);
      });
  });
  describe('town listeners and events', () => {
    let testingTown: CoveyTownController;
    const mockListeners = [mock<CoveyTownListener>(),
      mock<CoveyTownListener>(),
      mock<CoveyTownListener>()];
    beforeEach(() => {
      const townName = `town listeners and events tests ${nanoid()}`;
      testingTown = new CoveyTownController(townName, false);
      mockListeners.forEach(mockReset);
    });
    it('should notify added listeners of player movement when updatePlayerLocation is called', async () => {
      const player = new Player('test player');
      await testingTown.addPlayer(player);
      const newLocation = generateTestLocation();
      mockListeners.forEach(listener => testingTown.addTownListener(listener));
      testingTown.updatePlayerLocation(player, newLocation);
      mockListeners.forEach(listener => expect(listener.onPlayerMoved).toBeCalledWith(player));
    });
    it('should notify added listeners of player disconnections when destroySession is called', async () => {
      const player = new Player('test player');
      const session = await testingTown.addPlayer(player);

      mockListeners.forEach(listener => testingTown.addTownListener(listener));
      testingTown.destroySession(session);
      mockListeners.forEach(listener => expect(listener.onPlayerDisconnected).toBeCalledWith(player));
    });


    // STUDENT ADDED TEST
    it('should remove a participant from a conversation area when that session is destroyed', async () => {
      const removedPlayer = new Player('A test player');
      const otherPlayer = new Player('A non disconnecting player');
      const aThirdPlayer = new Player('A different non disconnecting player');
      const session = await testingTown.addPlayer(removedPlayer);
      await testingTown.addPlayer(otherPlayer);
      const area = {
        label: 'testing',
        topic: 'also testing',
        occupantsByID: [],
        boundingBox: {
          x: 10,
          y: 10,
          width: 10,
          height: 10,
        },
      };
      testingTown.addConversationArea(area);
      testingTown.updatePlayerLocation(aThirdPlayer, locationFromArea(area));
      testingTown.updatePlayerLocation(removedPlayer, locationFromArea(area));
      testingTown.updatePlayerLocation(otherPlayer, locationFromArea(area));

      testingTown.destroySession(session);
      expect(testingTown.conversationAreas.filter(t => t.topic === 'also testing')[0].occupantsByID.sort()).toStrictEqual(
        [otherPlayer.id, aThirdPlayer.id].sort(),
      );
    });

    it('should notify added listeners of new players when addPlayer is called', async () => {
      mockListeners.forEach(listener => testingTown.addTownListener(listener));

      const player = new Player('test player');
      await testingTown.addPlayer(player);
      mockListeners.forEach(listener => expect(listener.onPlayerJoined).toBeCalledWith(player));

    });
    it('should notify added listeners that the town is destroyed when disconnectAllPlayers is called', async () => {
      const player = new Player('test player');
      await testingTown.addPlayer(player);

      mockListeners.forEach(listener => testingTown.addTownListener(listener));
      testingTown.disconnectAllPlayers();
      mockListeners.forEach(listener => expect(listener.onTownDestroyed).toBeCalled());

    });
    it('should not notify removed listeners of player movement when updatePlayerLocation is called', async () => {
      const player = new Player('test player');
      await testingTown.addPlayer(player);

      mockListeners.forEach(listener => testingTown.addTownListener(listener));
      const newLocation = generateTestLocation();
      const listenerRemoved = mockListeners[1];
      testingTown.removeTownListener(listenerRemoved);
      testingTown.updatePlayerLocation(player, newLocation);
      expect(listenerRemoved.onPlayerMoved).not.toBeCalled();
    });
    it('should not notify removed listeners of player disconnections when destroySession is called', async () => {
      const player = new Player('test player');
      const session = await testingTown.addPlayer(player);

      mockListeners.forEach(listener => testingTown.addTownListener(listener));
      const listenerRemoved = mockListeners[1];
      testingTown.removeTownListener(listenerRemoved);
      testingTown.destroySession(session);
      expect(listenerRemoved.onPlayerDisconnected).not.toBeCalled();

    });
    it('should not notify removed listeners of new players when addPlayer is called', async () => {
      const player = new Player('test player');

      mockListeners.forEach(listener => testingTown.addTownListener(listener));
      const listenerRemoved = mockListeners[1];
      testingTown.removeTownListener(listenerRemoved);
      const session = await testingTown.addPlayer(player);
      testingTown.destroySession(session);
      expect(listenerRemoved.onPlayerJoined).not.toBeCalled();
    });

    it('should not notify removed listeners that the town is destroyed when disconnectAllPlayers is called', async () => {
      const player = new Player('test player');
      await testingTown.addPlayer(player);

      mockListeners.forEach(listener => testingTown.addTownListener(listener));
      const listenerRemoved = mockListeners[1];
      testingTown.removeTownListener(listenerRemoved);
      testingTown.disconnectAllPlayers();
      expect(listenerRemoved.onTownDestroyed).not.toBeCalled();

    });
  });
  describe('townSubscriptionHandler', () => {
    const mockSocket = mock<Socket>();
    let testingTown: CoveyTownController;
    let player: Player;
    let session: PlayerSession;
    beforeEach(async () => {
      const townName = `connectPlayerSocket tests ${nanoid()}`;
      testingTown = CoveyTownsStore.getInstance().createTown(townName, false);
      mockReset(mockSocket);
      player = new Player('test player');
      session = await testingTown.addPlayer(player);
    });
    it('should reject connections with invalid town IDs by calling disconnect', async () => {
      TestUtils.setSessionTokenAndTownID(nanoid(), session.sessionToken, mockSocket);
      townSubscriptionHandler(mockSocket);
      expect(mockSocket.disconnect).toBeCalledWith(true);
    });
    it('should reject connections with invalid session tokens by calling disconnect', async () => {
      TestUtils.setSessionTokenAndTownID(testingTown.coveyTownID, nanoid(), mockSocket);
      townSubscriptionHandler(mockSocket);
      expect(mockSocket.disconnect).toBeCalledWith(true);
    });
    describe('with a valid session token', () => {
      it('should add a town listener, which should emit "newPlayer" to the socket when a player joins', async () => {
        TestUtils.setSessionTokenAndTownID(testingTown.coveyTownID, session.sessionToken, mockSocket);
        townSubscriptionHandler(mockSocket);
        await testingTown.addPlayer(player);
        expect(mockSocket.emit).toBeCalledWith('newPlayer', player);
      });
      it('should add a town listener, which should emit "playerMoved" to the socket when a player moves', async () => {
        TestUtils.setSessionTokenAndTownID(testingTown.coveyTownID, session.sessionToken, mockSocket);
        townSubscriptionHandler(mockSocket);
        testingTown.updatePlayerLocation(player, generateTestLocation());
        expect(mockSocket.emit).toBeCalledWith('playerMoved', player);

      });
      it('should add a town listener, which should emit "playerDisconnect" to the socket when a player disconnects', async () => {
        TestUtils.setSessionTokenAndTownID(testingTown.coveyTownID, session.sessionToken, mockSocket);
        townSubscriptionHandler(mockSocket);
        testingTown.destroySession(session);
        expect(mockSocket.emit).toBeCalledWith('playerDisconnect', player);
      });
      it('should add a town listener, which should emit "townClosing" to the socket and disconnect it when disconnectAllPlayers is called', async () => {
        TestUtils.setSessionTokenAndTownID(testingTown.coveyTownID, session.sessionToken, mockSocket);
        townSubscriptionHandler(mockSocket);
        testingTown.disconnectAllPlayers();
        expect(mockSocket.emit).toBeCalledWith('townClosing');
        expect(mockSocket.disconnect).toBeCalledWith(true);
      });
      describe('when a socket disconnect event is fired', () => {
        it('should remove the town listener for that socket, and stop sending events to it', async () => {
          TestUtils.setSessionTokenAndTownID(testingTown.coveyTownID, session.sessionToken, mockSocket);
          townSubscriptionHandler(mockSocket);

          // find the 'disconnect' event handler for the socket, which should have been registered after the socket was connected
          const disconnectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'disconnect');
          if (disconnectHandler && disconnectHandler[1]) {
            disconnectHandler[1]();
            const newPlayer = new Player('should not be notified');
            await testingTown.addPlayer(newPlayer);
            expect(mockSocket.emit).not.toHaveBeenCalledWith('newPlayer', newPlayer);
          } else {
            fail('No disconnect handler registered');
          }
        });
        it('should destroy the session corresponding to that socket', async () => {
          TestUtils.setSessionTokenAndTownID(testingTown.coveyTownID, session.sessionToken, mockSocket);
          townSubscriptionHandler(mockSocket);

          // find the 'disconnect' event handler for the socket, which should have been registered after the socket was connected
          const disconnectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'disconnect');
          if (disconnectHandler && disconnectHandler[1]) {
            disconnectHandler[1]();
            mockReset(mockSocket);
            TestUtils.setSessionTokenAndTownID(testingTown.coveyTownID, session.sessionToken, mockSocket);
            townSubscriptionHandler(mockSocket);
            expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
          } else {
            fail('No disconnect handler registered');
          }

        });
      });
      it('should forward playerMovement events from the socket to subscribed listeners', async () => {
        TestUtils.setSessionTokenAndTownID(testingTown.coveyTownID, session.sessionToken, mockSocket);
        townSubscriptionHandler(mockSocket);
        const mockListener = mock<CoveyTownListener>();
        testingTown.addTownListener(mockListener);
        // find the 'playerMovement' event handler for the socket, which should have been registered after the socket was connected
        const playerMovementHandler = mockSocket.on.mock.calls.find(call => call[0] === 'playerMovement');
        if (playerMovementHandler && playerMovementHandler[1]) {
          const newLocation = generateTestLocation();
          player.location = newLocation;
          playerMovementHandler[1](newLocation);
          expect(mockListener.onPlayerMoved).toHaveBeenCalledWith(player);
        } else {
          fail('No playerMovement handler registered');
        }
      });
    });
  });
  describe('addConversationArea', () => {
    let testingTown: CoveyTownController;
    beforeEach(() => {
      const townName = `addConversationArea test town ${nanoid()}`;
      testingTown = new CoveyTownController(townName, false);
    });
    it('should add the conversation area to the list of conversation areas', ()=>{
      const newConversationArea = TestUtils.createConversationForTesting();
      const result = testingTown.addConversationArea(newConversationArea);
      expect(result).toBe(true);
      const areas = testingTown.conversationAreas;
      expect(areas.length).toEqual(1);
      expect(areas[0].label).toEqual(newConversationArea.label);
      expect(areas[0].topic).toEqual(newConversationArea.topic);
      expect(areas[0].boundingBox).toEqual(newConversationArea.boundingBox);
    });

    // STUDENT ADDED TESTS
    it('should not add the conversation area if the label already exists', async () => {
      const duplicatedLabel = nanoid();
      const locationForTestingArea = generateTestLocation();
      const secondLocation = {
        ...locationForTestingArea,
        x: locationForTestingArea.x + 1,
        y: locationForTestingArea.x + 1,
      };

      const resp = testingTown.addConversationArea({
        ...areaFromLocation(locationForTestingArea),
        label: duplicatedLabel,
      });
      expect(resp).toBeTruthy();

      const resp2 = testingTown.addConversationArea({
        ...areaFromLocation(secondLocation),
        label: duplicatedLabel,
      });

      expect(resp2).toBeFalsy();
    });
    it('should require a non empty string topic', async () => {
      const locationForTestingArea = generateTestLocation();

      const resp = testingTown.addConversationArea({
        ...areaFromLocation(locationForTestingArea),
        topic: '',
      });

      expect(resp).toBeFalsy();
    });

    test.each([
      ['left', { x: -1, y: 0 }],
      ['right', { x: 1, y: 0 }],
      ['top', { x: 0, y: -1 }],
      ['bottom', { x: 0, y: 1 }],
    ])('it should disallow %s intersection', (m, b) => {
      const startingBox: BoundingBox = {
        x: 10,
        y: 10,
        width: 2,
        height: 2,
      };
      const startingArea: ServerConversationArea = {
        label: nanoid(),
        topic: nanoid(),
        occupantsByID: [],
        boundingBox: startingBox,
      };
      let resp = testingTown.addConversationArea(
        startingArea,
      );
      expect(resp).toBeTruthy();

      const newAreaTemp: ServerConversationArea = {
        label: m,
        topic: nanoid(),
        occupantsByID: [],
        boundingBox: {
          ...startingBox,
          x: startingBox.x + b.x,
          y: startingBox.y + b.y,
        },
      };
      resp = testingTown.addConversationArea(newAreaTemp);
      expect(resp).toBeFalsy();
    });

    test.each([
      ['left', { x: -2, y: 0 }],
      ['right', { x: 2, y: 0 }],
      ['top', { x: 0, y: -2 }],
      ['bottom', { x: 0, y: 2 }],
    ])('it should allow %s boundary intersection', (m, b) => {
      const startingBox: BoundingBox = {
        x: 10,
        y: 10,
        width: 2,
        height: 2,
      };
      const startingArea: ServerConversationArea = {
        label: nanoid(),
        topic: nanoid(),
        occupantsByID: [],
        boundingBox: startingBox,
      };
      let resp = testingTown.addConversationArea(
        startingArea,
      );
      expect(resp).toBeTruthy();

      const newAreaTemp: ServerConversationArea = {
        label: m,
        topic: nanoid(),
        occupantsByID: [],
        boundingBox: {
          ...startingBox,
          x: startingBox.x + b.x,
          y: startingBox.y + b.y,
        },
      };
      resp = testingTown.addConversationArea(newAreaTemp);
      expect(resp).toBeTruthy();
    });

    test.each([
      ['left', { x: 9, y: 10 }],
      ['right', { x: 11, y: 10 }],
      ['top', { x: 10, y: 11 }],
      ['bottom', { x: 10, y: 9 }],
    ])('it should not count player on %s boundary in area when creating area', async (m, b) => {
      const newPlayer = new Player(nanoid());
      await testingTown.addPlayer(newPlayer);

      testingTown.updatePlayerLocation(newPlayer, {
        ...b,
        rotation: 'front',
        moving: false,
      });

      const newArea: ServerConversationArea = {
        topic: m,
        label: nanoid(),
        boundingBox: {
          x: 10,
          y: 10,
          width: 2,
          height: 2,
        },
        occupantsByID: [],
      };

      const resp = testingTown.addConversationArea(newArea);
      expect(resp).toBeTruthy();

      expect(newPlayer.activeConversationArea).toBeUndefined();
      expect(newArea.occupantsByID.length).toBe(0);
    });

    it('should update a players area when created and notify listeners', async () => {
      const newPlayer = new Player(nanoid());
      await testingTown.addPlayer(newPlayer);

      testingTown.updatePlayerLocation(newPlayer, {
        x: 10,
        y: 10,
        rotation: 'front',
        moving: false,
      });

      const expectedAreaTopic = nanoid();
      const newArea: ServerConversationArea = {
        topic: expectedAreaTopic,
        label: nanoid(),
        boundingBox: {
          x: 10,
          y: 10,
          width: 2,
          height: 2,
        },
        occupantsByID: [],
      };

      const conversationListener = mock<CoveyTownListener>();
      testingTown.addTownListener(conversationListener);

      const resp = testingTown.addConversationArea(newArea);

      expect(resp).toBeTruthy();

      expect(conversationListener.onConversationAreaUpdated).toHaveBeenCalledTimes(1);

      expect(newPlayer.activeConversationArea?.topic).toEqual(expectedAreaTopic);

      expect(newArea.occupantsByID).toStrictEqual([newPlayer.id]);

    });
  });
  describe('updatePlayerLocation', () =>{
    let testingTown: CoveyTownController;
    beforeEach(() => {
      const townName = `updatePlayerLocation test town ${nanoid()}`;
      testingTown = new CoveyTownController(townName, false);
    });
    it('should respect the conversation area reported by the player userLocation.conversationLabel, and not override it based on the player\'s x,y location', async ()=>{
      const newConversationArea = TestUtils.createConversationForTesting({ boundingBox: { x: 10, y: 10, height: 5, width: 5 } });
      const result = testingTown.addConversationArea(newConversationArea);
      expect(result).toBe(true);
      const player = new Player(nanoid());
      await testingTown.addPlayer(player);

      const newLocation:UserLocation = { moving: false, rotation: 'front', x: 25, y: 25, conversationLabel: newConversationArea.label };
      testingTown.updatePlayerLocation(player, newLocation);
      expect(player.activeConversationArea?.label).toEqual(newConversationArea.label);
      expect(player.activeConversationArea?.topic).toEqual(newConversationArea.topic);
      expect(player.activeConversationArea?.boundingBox).toEqual(newConversationArea.boundingBox);

      const areas = testingTown.conversationAreas;
      expect(areas[0].occupantsByID.length).toBe(1);
      expect(areas[0].occupantsByID[0]).toBe(player.id);

    });
    it('should emit an onConversationUpdated event when a conversation area gets a new occupant', async () =>{

      const newConversationArea = TestUtils.createConversationForTesting({ boundingBox: { x: 10, y: 10, height: 5, width: 5 } });
      const result = testingTown.addConversationArea(newConversationArea);
      expect(result).toBe(true);

      const mockListener = mock<CoveyTownListener>();
      testingTown.addTownListener(mockListener);

      const player = new Player(nanoid());
      await testingTown.addPlayer(player);
      const newLocation:UserLocation = { moving: false, rotation: 'front', x: 25, y: 25, conversationLabel: newConversationArea.label };
      testingTown.updatePlayerLocation(player, newLocation);
      expect(mockListener.onConversationAreaUpdated).toHaveBeenCalledTimes(1);
    });

    // STUDENT ADDED TESTS
    it('should emit an on player moved when the player moves', async () => {
      const movementListener = mock<CoveyTownListener>();
      testingTown.addTownListener(movementListener);

      const player = new Player(nanoid());
      await testingTown.addPlayer(player);
      const location = generateTestLocation();

      testingTown.updatePlayerLocation(player, location);
      expect(movementListener.onPlayerMoved).toHaveBeenCalledTimes(1);
      expect(movementListener.onPlayerMoved).toHaveBeenCalledWith(player);
    });

    it('should emit 2 conversationAreaUpdated when the player leaves one area and enters another immediately',
      async () => {
        const conversationListener = mock<CoveyTownListener>();
        const player = new Player(nanoid());
        const remainingPlayer = new Player(nanoid());
        const area1: ServerConversationArea  = {
          label: nanoid(),
          topic: nanoid(),
          boundingBox: {
            x: 10,
            y: 10,
            width: 1,
            height: 1,
          },
          occupantsByID: [remainingPlayer.id, remainingPlayer.id],
        };
        const area2: ServerConversationArea  = {
          label: nanoid(),
          topic: nanoid(),
          boundingBox: {
            x: 20,
            y: 20,
            width: 1,
            height: 1,
          },
          occupantsByID: [],
        };
        testingTown.addConversationArea(area1);
        testingTown.addConversationArea(area2);

        const location1: UserLocation = {
          x: area1.boundingBox.x,
          y: area1.boundingBox.y,
          rotation: 'front',
          conversationLabel: area1.label,
          moving: false,
        };

        testingTown.updatePlayerLocation(player, location1);
        testingTown.updatePlayerLocation(remainingPlayer, location1);

        testingTown.addTownListener(conversationListener);

        testingTown.updatePlayerLocation(player, {
          x: area2.boundingBox.x,
          y: area2.boundingBox.y,
          rotation: 'front',
          conversationLabel: area2.label,
          moving: false,
        });
        expect(conversationListener.onConversationAreaDestroyed).not.toHaveBeenCalled();
        expect(conversationListener.onConversationAreaUpdated).toHaveBeenCalledTimes(2);
        expect(conversationListener.onConversationAreaUpdated).toHaveBeenCalledWith(
          {
            ...area1,
            occupantsByID: [remainingPlayer.id],
          },
        );
        expect(conversationListener.onConversationAreaUpdated).toHaveBeenCalledWith(
          {
            ...area2,
            occupantsByID: [player.id],
          },
        );
      });

    it('should destroy the conversation area on last participant leaving', async () => {
      const destroyListener = mock<CoveyTownListener>();
      const player = new Player(nanoid());
      await testingTown.addPlayer(player);

      const location: UserLocation = {
        ...generateTestLocation(),
        conversationLabel: nanoid(),
      };
      const area = areaFromLocation(location);
      const adjArea = areaFromLocation({
        ...location,
        x: location.x + 1,
        y: location.y + 1,
        conversationLabel: nanoid(),
      });
      const anotherArea = areaFromLocation({
        ...location,
        x: location.x + 2,
        y: location.y + 2,
        conversationLabel: nanoid(),
      });

      testingTown.addConversationArea(anotherArea);
      testingTown.addConversationArea(area);
      testingTown.addConversationArea(adjArea);

      testingTown.updatePlayerLocation(player, location);
      testingTown.addTownListener(destroyListener);

      testingTown.updatePlayerLocation(player, {
        ...location,
        conversationLabel: undefined,
      });

      expect(destroyListener.onConversationAreaDestroyed).toHaveBeenCalledWith({
        ...area,
      });
      expect(destroyListener.onConversationAreaDestroyed).toHaveBeenCalled();

      expect(destroyListener.onConversationAreaUpdated).not.toHaveBeenCalled();

      expect(testingTown.conversationAreas.sort(sortArea)).toStrictEqual([adjArea, anotherArea].sort(sortArea));
    });

    it('should not alter player staying in the same area', async () => {
      const player = new Player(nanoid());
      await testingTown.addPlayer(player);
      const changeDetector = mock<CoveyTownListener>();

      const location: UserLocation = {
        ...generateTestLocation(),
        conversationLabel: nanoid(),
      };

      const area = areaFromLocation(location);

      testingTown.addConversationArea(area);
      testingTown.updatePlayerLocation(player, location);

      expect(player.activeConversationArea).toStrictEqual(area);

      testingTown.addTownListener(changeDetector);

      testingTown.updatePlayerLocation(player, location);

      expect(changeDetector.onConversationAreaUpdated).not.toHaveBeenCalled();

    });
  });
});
