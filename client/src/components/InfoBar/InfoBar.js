import React from 'react';

import closeIcon from '../../icons/closeIcon.png';
import onlineIcon from '../../icons/onlineIcon.png';

import './InfoBar.css';

const OnlineList = ({ users }) => {
    let _users = [];
    users.forEach((user) => _users.push(user.name));
    return _users.join(', ');
};

const InfoBar = ({ room, users }) => (
    <div className="infoBar" title="Room">
        <div className="leftInnerContainer">
            <img className="onlineIcon" src={onlineIcon} alt="online"/>
            <h3>{room}<br/>(<OnlineList users={users}/>) </h3>
        </div>
        <div className="rightInnerContainer" title="Logout">
            <a href="/"><img src={closeIcon} alt="close"/></a>
        </div>
    </div>
);

export default InfoBar;