//
// Routing
//
Router.configure({
    layoutTemplate: 'layout'
});
Router.route('/dojo/', {
    template: 'home'
});
Router.route('/dojo/groupActivity', {
    name: 'groupActivity'
});
Router.route('/dojo/preferences', {
    name: 'preferences'
});


//
// Databases
//
UserData = new Mongo.Collection("UserData");
UserData.allow({
  insert: function (userId, doc) { return false; },
  update: function (userId, doc, fields, modifier) {
    return doc.userId == userId && !_.contains(fields, userId);
  },
  remove: function (userId, doc) { return false; }
});
if (Meteor.isServer) {
  Meteor.publish(null, function () {
    if (this.userId) {
      return UserData.find({}, {fields: {"username": 1, "userId": 1}});
    }
  });
  Meteor.publish(null, function () {
    if (this.userId) {
      return UserData.find({"userId": this.userId});
    }
  });
}

currentUserData = function () {
  return UserData.findOne({"userId": Meteor.userId()});
};
otherUsers = function () {
  return UserData.find({"userId": {$ne: Meteor.userId()}});
};


if (Meteor.isClient) {
  Accounts.ui.config({
    passwordSignupFields: "USERNAME_AND_EMAIL"
  });

  //
  // User selection ui element
  //
  Session.set("userSelection", []); // this really shouldn't be a session value
  Template.userSelect.helpers({
    allUsers: function (state) {
      var users = UserData.find().fetch();
      users.forEach(function (user) {
        var isSelected = _.contains(Session.get("userSelection"), user.userId);
        user.selectionColor = isSelected ? "green" : "white";
      });
      return users;
    },
  });
  Template.userSelect.events({
    'click .userSelectName': function (event) {
      var sel = Session.get("userSelection");
      if (_.contains(sel, this.userId)) {
        sel = _.without(sel, this.userId);
      } else {
        sel.push(this.userId);
      }
      Session.set("userSelection", sel);
    }
  });

  //
  // User preferences ui element
  //
  Template.userPref.helpers({
    otherUsers: function (state) {
      var data = currentUserData();
      if (!data || data.preferredGrouping === undefined)
        return [];
      var users = otherUsers().fetch();

      users.forEach(function (user) {
        var status = data.preferredGrouping[user.userId] || "3";
        var map = {
          "6": "green",
          "3": "white",
          "1": "red"
        };
        user.selectionColor = map[status] || "white";
      });
      return users;
    },
  });
  Template.userPref.events({
    'click .userPrefName': function (event) {
      var data = currentUserData();
      var newGrouping = data.preferredGrouping;
      var currentPref = newGrouping[this.userId] || "3";
      var nextPref = {
        "1": "3",
        "3": "6",
        "6": "1",
      };
      newGrouping[this.userId] = nextPref[currentPref] || "3";
      UserData.update({_id: data._id},
                      {$set: {preferredGrouping: newGrouping}});
    },
  });

  //
  // Creating groups and their output
  //
  Session.set("groups", []);
  Template.groupActivity.events({
    'click button': function (event) {
      var sel = Session.get("userSelection");
      var groupSize = Template.instance().find("#groupsize").value;
      var extraPeople = Template.instance().find("#extrapeople").value;
      Meteor.call("makeGroups", sel, groupSize, extraPeople, function (error, result) {
        Session.set("groups", result);
      });
    },
  });
  Template.groupActivity.helpers({
    groups: function () {
      return Session.get("groups");
    },
  });

  Template.preferences.helpers({
    currentUserData: currentUserData,
  });

}

if (Meteor.isServer) {
  Accounts.emailTemplates.from = "no-reply@incasoftware.de";

  Accounts.onCreateUser(function (options, user) {
    var username = user.username;
    if (!/-dojo$/.test(user.username))
      throw new Meteor.Error(400, "Validation failed");
    UserData.insert({
      "userId": user._id,
      "username": username,
      "preferredGrouping": {},
    });
    return user;
  });

  Meteor.methods({
    makeGroups: function (participants, groupSize, extraPeople) {
      var getPref = function (prefs, userId) {
        if (userId === "extra" && !prefs.hasOwnProperty("extra"))
          return 1;
        return prefs[userId] || prefs["default"] || 3;
      };

      if (participants.length == 0)
        return [];

      participants = _.map(participants, function (id) {
        return UserData.findOne({userId: id});
      });

      _.times(extraPeople, function (i) {
        participants.push({
          _id: "extra" + i,
          userId: "extra",
          username: "Extra " + (i+1),
          preferredGrouping: {"default":1},
        });
      });

      // Calculate the number of groups
      var nGroups = Math.floor(participants.length / groupSize);
      if (participants.length % groupSize > 1)
        nGroups += 1;
      if (nGroups < 1)
        nGroups = 1;

      // Initialize groups
      //
      // The 'prefs' member contains the list of people who could be picked
      // into the group. Initially it's just the list of people to distribute,
      // but later on people who fit better into the group will appear several
      // times. (that's wasteful but simple)
      var groups = [];
      _.times(nGroups, function () {
        groups.push({participants:[], prefs:participants.slice()});
      });

      // Let each group pick a new member according to their preferences
      while (groups[0].prefs.length > 0) {
        groups = _.shuffle(groups);
        _.forEach(groups, function (group) {
          if (group.prefs.length == 0)
            return;

          // Select new group member
          var newMember = _.sample(group.prefs);
          group.participants.push({username: newMember.username});

          // Remove the member from all group prefs
          _.forEach(groups, function (inner_group) {
            inner_group.prefs = _.filter(inner_group.prefs, function (u) {
              return u._id != newMember._id;
            });
          });

          // Update preferences about the next member
          var newPrefs = newMember.preferredGrouping;
          var newGroupPrefs = [];
          _.forEach(group.prefs, function (user) {
            var otherPrefs = user.preferredGrouping;
            var newPref = getPref(newPrefs, user.userId);
            var otherPref = getPref(otherPrefs, newMember.userId);
            _.times(newPref*otherPref, function () {
              newGroupPrefs.push(user);
            });
          });
          group.prefs = newGroupPrefs;
        });
      }

      // Shuffle group members.
      _.forEach(groups, function (group) {
        group.participants = _.shuffle(group.participants);
        delete group.prefs;
      });

      return groups;
    },
  });
}
